/**
 * 文件传输服务
 * 处理P2P文件传输 - 支持超高速多线程并行下载
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  FileTransferRequest,
  FileTransferProgress,
  FileChunk,
  FileShareSignalingMessage,
} from '../../types';

const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB per chunk (超大分块，减少往返和序列化开销)
const MAX_CONCURRENT_FILES = 10; // 最多同时下载10个文件
const MAX_THREADS_PER_FILE = 12; // 每个文件最多12个线程（激进并发）

// 扩展FileTransferRequest以支持范围请求
interface RangeRequest extends FileTransferRequest {
  rangeStart?: number;
  rangeEnd?: number;
  threadId?: number;
}

// 线程完成状态跟踪
interface ThreadCompletionTracker {
  totalThreads: number;
  completedThreads: Set<number>;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class FileTransferService {
  private websocket: WebSocket | null = null;
  private localPlayerId: string = '';
  private transfers: Map<string, FileTransferProgress> = new Map();
  private downloadBuffers: Map<string, Uint8Array[]> = new Map();
  private transferStartTimes: Map<string, number> = new Map();
  private lastProgressUpdate: Map<string, { time: number; size: number }> = new Map();
  
  // 多线程下载支持
  private activeDownloads: Set<string> = new Set();
  private downloadQueue: Array<() => Promise<void>> = [];
  private threadBuffers: Map<string, Map<number, Map<number, Uint8Array>>> = new Map();
  private threadCompletionTrackers: Map<string, ThreadCompletionTracker> = new Map();
  
  // P2P DataChannel 支持
  private dataChannels: Map<string, RTCDataChannel> = new Map(); // playerId -> DataChannel
  private pendingChunks: Map<string, Map<number, Uint8Array>> = new Map(); // requestId -> chunkIndex -> data
  
  // 事件回调
  private onTransferProgressCallback?: (progress: FileTransferProgress) => void;
  private onTransferCompleteCallback?: (requestId: string, filePath: string) => void;
  private onTransferErrorCallback?: (requestId: string, error: string) => void;

  /**
   * 初始化文件传输服务
   */
  initialize(playerId: string): void {
    console.log('📡 初始化文件传输服务...');
    
    this.transfers.clear();
    this.downloadBuffers.clear();
    this.transferStartTimes.clear();
    this.lastProgressUpdate.clear();
    this.activeDownloads.clear();
    this.downloadQueue = [];
    this.threadBuffers.clear();
    this.threadCompletionTrackers.clear();
    this.dataChannels.clear();
    this.pendingChunks.clear();
    console.log('✅ 已清理旧的文件传输数据');
    
    this.localPlayerId = playerId;
    console.log('✅ 文件传输服务初始化完成');
  }
  
  /**
   * DataChannel 就绪回调
   */
  onDataChannelReady(playerId: string, channel: RTCDataChannel): void {
    console.log(`📁 FileTransferService: DataChannel 就绪 for ${playerId}, 状态: ${channel.readyState}`);
    this.dataChannels.set(playerId, channel);
    console.log(`📊 当前已注册的DataChannels: ${Array.from(this.dataChannels.keys()).join(', ')}`);
  }
  
  /**
   * 处理 DataChannel 消息（二进制数据）
   */
  handleDataChannelMessage(playerId: string, data: ArrayBuffer | Blob): void {
    try {
      if (data instanceof ArrayBuffer) {
        this.processDataChannelMessage(playerId, data);
      } else if (data instanceof Blob) {
        // 将 Blob 转换为 ArrayBuffer
        data.arrayBuffer().then(buffer => {
          this.processDataChannelMessage(playerId, buffer);
        });
      }
    } catch (error) {
      console.error('❌ 处理 DataChannel 消息失败:', error);
    }
  }
  
  /**
   * 处理二进制消息
   */
  private processDataChannelMessage(_playerId: string, buffer: ArrayBuffer): void {
    try {
      const view = new DataView(buffer);
      
      // 消息格式：
      // [0-3]: 消息类型 (4字节)
      //   0 = 文件分块
      //   1 = 传输完成
      //   2 = 传输错误
      // [4-7]: requestId 长度 (4字节)
      // [8-...]: requestId (UTF-8字符串)
      // [...]: 其他数据
      
      const messageType = view.getUint32(0, true);
      const requestIdLength = view.getUint32(4, true);
      const requestIdBytes = new Uint8Array(buffer, 8, requestIdLength);
      const requestId = new TextDecoder().decode(requestIdBytes);
      
      const dataOffset = 8 + requestIdLength;
      
      if (messageType === 0) {
        // 文件分块
        // [dataOffset]: chunkIndex (4字节)
        // [dataOffset+4]: totalChunks (4字节) - 暂不使用
        // [dataOffset+8]: 分块数据
        const chunkIndex = view.getUint32(dataOffset, true);
        // const totalChunks = view.getUint32(dataOffset + 4, true); // 暂不使用
        const chunkData = new Uint8Array(buffer, dataOffset + 8);
        
        this.handleFileChunk(requestId, chunkIndex, Array.from(chunkData), false);
      } else if (messageType === 1) {
        // 传输完成
        this.handleTransferComplete(requestId);
      } else if (messageType === 2) {
        // 传输错误
        const errorBytes = new Uint8Array(buffer, dataOffset);
        const error = new TextDecoder().decode(errorBytes);
        this.handleTransferError(requestId, error);
      }
    } catch (error) {
      console.error('❌ 处理二进制消息失败:', error);
    }
  }
  
  /**
   * 设置WebSocket连接
   */
  setWebSocket(websocket: WebSocket): void {
    this.websocket = websocket;
  }

  /**
   * 请求下载文件（支持多线程）
   */
  async requestDownload(
    shareId: string,
    ownerId: string,
    filePath: string,
    fileName: string,
    fileSize: number,
    savePath: string
  ): Promise<string> {
    try {
      console.log('📥 请求下载文件:', fileName, '大小:', this.formatSize(fileSize));

      const requestId = `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const progress: FileTransferProgress = {
        requestId,
        fileName,
        totalSize: fileSize,
        transferredSize: 0,
        progress: 0,
        speed: 0,
        status: 'pending',
      };
      
      (progress as any).savePath = savePath;
      this.transfers.set(requestId, progress);
      this.transferStartTimes.set(requestId, Date.now());
      this.lastProgressUpdate.set(requestId, { time: Date.now(), size: 0 });

      const downloadTask = async () => {
        try {
          this.activeDownloads.add(requestId);
          await this.startMultiThreadDownload(requestId, shareId, ownerId, filePath, fileName, fileSize, savePath);
        } finally {
          this.activeDownloads.delete(requestId);
          this.processQueue();
        }
      };

      if (this.activeDownloads.size < MAX_CONCURRENT_FILES) {
        downloadTask();
      } else {
        this.downloadQueue.push(downloadTask);
        console.log(`📋 下载任务已加入队列，当前队列长度: ${this.downloadQueue.length}`);
      }

      return requestId;
    } catch (error) {
      console.error('❌ 请求下载文件失败:', error);
      throw error;
    }
  }

  /**
   * 处理下载队列
   */
  private processQueue(): void {
    while (this.downloadQueue.length > 0 && this.activeDownloads.size < MAX_CONCURRENT_FILES) {
      const task = this.downloadQueue.shift();
      if (task) {
        task();
      }
    }
  }

  /**
   * 开始多线程下载
   */
  private async startMultiThreadDownload(
    requestId: string,
    shareId: string,
    ownerId: string,
    filePath: string,
    fileName: string,
    fileSize: number,
    savePath: string
  ): Promise<void> {
    try {
      const threadCount = this.calculateThreadCount(fileSize);
      console.log(`🚀 启动 ${threadCount} 线程下载:`, fileName);

      // 初始化线程缓冲区（使用Map存储分块，支持乱序接收）
      const threadBufferMap = new Map<number, Map<number, Uint8Array>>();
      this.threadBuffers.set(requestId, threadBufferMap);

      // 创建线程完成跟踪器
      const completionPromise = new Promise<void>((resolve, reject) => {
        this.threadCompletionTrackers.set(requestId, {
          totalThreads: threadCount,
          completedThreads: new Set(),
          resolve,
          reject,
        });
      });

      // 计算每个线程的下载范围
      const ranges = this.calculateRanges(fileSize, threadCount);

      // 并行启动所有线程
      for (let threadId = 0; threadId < threadCount; threadId++) {
        const range = ranges[threadId];
        this.downloadRange(requestId, shareId, ownerId, filePath, fileName, fileSize, range.start, range.end, threadId, savePath);
      }

      // 等待所有线程完成
      await completionPromise;

      // 合并所有线程的数据
      await this.mergeThreadData(requestId, threadCount, savePath);

    } catch (error) {
      console.error('❌ 多线程下载失败:', error);
      this.handleTransferError(requestId, String(error));
    }
  }

  /**
   * 计算线程数（激进策略）
   */
  private calculateThreadCount(fileSize: number): number {
    if (fileSize < 1 * 1024 * 1024) { // < 1MB
      return 2;
    } else if (fileSize < 5 * 1024 * 1024) { // < 5MB
      return 4;
    } else if (fileSize < 20 * 1024 * 1024) { // < 20MB
      return 8;
    } else if (fileSize < 100 * 1024 * 1024) { // < 100MB
      return 10;
    } else {
      return MAX_THREADS_PER_FILE; // >= 100MB，使用最大线程数
    }
  }

  /**
   * 计算下载范围
   */
  private calculateRanges(fileSize: number, threadCount: number): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    const chunkSize = Math.ceil(fileSize / threadCount);

    for (let i = 0; i < threadCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, fileSize);
      ranges.push({ start, end });
    }

    return ranges;
  }

  /**
   * 下载指定范围的数据
   */
  private async downloadRange(
    requestId: string,
    shareId: string,
    ownerId: string,
    filePath: string,
    fileName: string,
    fileSize: number,
    rangeStart: number,
    rangeEnd: number,
    threadId: number,
    savePath: string
  ): Promise<void> {
    try {
      console.log(`🧵 线程 ${threadId} 开始下载范围: ${rangeStart}-${rangeEnd} (${this.formatSize(rangeEnd - rangeStart)})`);

      const threadBufferMap = this.threadBuffers.get(requestId);
      if (threadBufferMap) {
        threadBufferMap.set(threadId, new Map<number, Uint8Array>());
      }

      const request: RangeRequest = {
        requestId: `${requestId}-thread${threadId}`,
        shareId,
        ownerId,
        requesterId: this.localPlayerId,
        requesterName: '',
        filePath,
        fileName,
        fileSize,
        timestamp: Date.now(),
        rangeStart,
        rangeEnd,
        threadId,
      };

      await this.sendRangeRequest(request, savePath, requestId);

    } catch (error) {
      console.error(`❌ 线程 ${threadId} 下载失败:`, error);
      const tracker = this.threadCompletionTrackers.get(requestId);
      if (tracker) {
        tracker.reject(new Error(`线程 ${threadId} 失败: ${error}`));
      }
    }
  }

  /**
   * 发送范围请求
   */
  private async sendRangeRequest(request: RangeRequest, savePath: string, parentRequestId: string): Promise<void> {
    if (!this.websocket) {
      throw new Error('WebSocket未连接');
    }

    (request as any).savePath = savePath;
    (request as any).parentRequestId = parentRequestId;

    const message: FileShareSignalingMessage = {
      type: 'file-transfer-request',
      from: this.localPlayerId,
      to: request.ownerId,
      request: request as any,
    };

    this.websocket.send(JSON.stringify(message));
    console.log(`📤 已发送范围请求 [线程${request.threadId}]:`, request.fileName, `范围: ${request.rangeStart}-${request.rangeEnd}`);
  }

  /**
   * 处理传输请求（支持范围请求）
   */
  async handleTransferRequest(
    requestId: string,
    from: string,
    shareId: string,
    filePath: string,
    fileName: string,
    fileSize: number,
    rangeStart?: number,
    rangeEnd?: number,
    threadId?: number
  ): Promise<void> {
    try {
      console.log('📥 收到文件传输请求:', fileName, rangeStart !== undefined ? `范围: ${rangeStart}-${rangeEnd}` : '完整文件');

      const { fileShareService } = await import('./FileShareService');
      const localShares = fileShareService.getLocalShares();
      const share = localShares.find(s => s.id === shareId);
      
      if (!share) {
        throw new Error('共享不存在');
      }
      
      const fullPath = `${share.folderPath}/${filePath}`;

      const request: RangeRequest = {
        requestId,
        shareId,
        ownerId: this.localPlayerId,
        requesterId: from,
        requesterName: '',
        filePath: fullPath,
        fileName,
        fileSize,
        timestamp: Date.now(),
        rangeStart,
        rangeEnd,
        threadId,
      };

      await this.acceptTransferRequest(request);
    } catch (error) {
      console.error('❌ 处理传输请求失败:', error);
      this.sendTransferError(requestId, from, String(error));
    }
  }

  /**
   * 接受传输请求并开始传输
   */
  private async acceptTransferRequest(request: RangeRequest): Promise<void> {
    try {
      console.log('✅ 接受传输请求:', request.fileName);

      this.sendTransferResponse(request.requestId, request.requesterId, true);
      await this.sendFile(request);
    } catch (error) {
      console.error('❌ 接受传输请求失败:', error);
      this.sendTransferError(request.requestId, request.requesterId, String(error));
    }
  }

  /**
   * 发送文件（支持范围发送，批量发送优化）
   */
  private async sendFile(request: RangeRequest): Promise<void> {
    try {
      const isRangeRequest = request.rangeStart !== undefined && request.rangeEnd !== undefined;
      console.log(`📤 开始发送文件${isRangeRequest ? ` [线程${request.threadId}]` : ''}:`, request.fileName);
      console.log(`📤 发送目标玩家ID: ${request.requesterId}`);
      console.log(`📊 当前已注册的DataChannels: ${Array.from(this.dataChannels.keys()).join(', ')}`);
      
      // 检查DataChannel状态
      const channel = this.dataChannels.get(request.requesterId);
      if (channel) {
        console.log(`✅ 找到DataChannel for ${request.requesterId}, 状态: ${channel.readyState}`);
      } else {
        console.log(`⚠️ 未找到DataChannel for ${request.requesterId}`);
      }

      const fileData = await invoke<number[]>('read_file_bytes', {
        path: request.filePath,
      });

      let data: Uint8Array;
      if (isRangeRequest) {
        const fullData = new Uint8Array(fileData);
        data = fullData.slice(request.rangeStart!, request.rangeEnd!);
        console.log(`📦 范围数据大小: ${data.length} 字节`);
      } else {
        data = new Uint8Array(fileData);
      }

      const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
      console.log(`分块数: ${totalChunks}, 分块大小: ${CHUNK_SIZE} 字节`);

      // 批量发送，使用 Promise.all 并发发送多个分块
      const BATCH_SIZE = 5; // 每批发送5个分块
      for (let batchStart = 0; batchStart < totalChunks; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, totalChunks);
        const sendPromises: Promise<void>[] = [];
        
        for (let i = batchStart; i < batchEnd; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, data.length);
          const chunkData = data.slice(start, end);

          const chunk: FileChunk = {
            requestId: request.requestId,
            chunkIndex: i,
            totalChunks,
            data: chunkData,
          };

          // 异步发送，不等待
          sendPromises.push(Promise.resolve(this.sendChunk(request.requesterId, chunk)));
        }
        
        // 等待当前批次发送完成
        await Promise.all(sendPromises);
      }

      this.sendTransferComplete(request.requestId, request.requesterId);

      console.log(`✅ 文件发送完成${isRangeRequest ? ` [线程${request.threadId}]` : ''}:`, request.fileName);
    } catch (error) {
      console.error('❌ 发送文件失败:', error);
      this.sendTransferError(request.requestId, request.requesterId, String(error));
    }
  }

  /**
   * 发送文件分块（仅使用 DataChannel P2P传输）
   */
  private sendChunk(to: string, chunk: FileChunk): void {
    // 必须使用 DataChannel，不允许回退到 WebSocket
    const channel = this.dataChannels.get(to);
    
    console.log(`📤 发送分块 ${chunk.chunkIndex}/${chunk.totalChunks} to ${to}, DataChannel存在: ${!!channel}, 状态: ${channel?.readyState}`);
    
    if (!channel) {
      const error = `❌ DataChannel不存在 for ${to}，无法发送文件！已注册的channels: ${Array.from(this.dataChannels.keys()).join(', ')}`;
      console.error(error);
      throw new Error(`P2P连接未建立，无法传输文件`);
    }
    
    if (channel.readyState !== 'open') {
      const error = `❌ DataChannel状态异常: ${channel.readyState}，无法发送文件！`;
      console.error(error);
      throw new Error(`P2P连接状态异常: ${channel.readyState}`);
    }
    
    try {
      // 检查缓冲区，避免过载
      if (channel.bufferedAmount > 16 * 1024 * 1024) { // 16MB
        // 缓冲区过大，等待一下
        console.log(`⏳ DataChannel缓冲区过大 (${channel.bufferedAmount} bytes)，等待...`);
        setTimeout(() => this.sendChunk(to, chunk), 10);
        return;
      }
      
      const requestIdBytes = new TextEncoder().encode(chunk.requestId);
      const chunkData = chunk.data;
      
      // 构建二进制消息
      // [0-3]: 消息类型 (0 = 文件分块)
      // [4-7]: requestId 长度
      // [8-...]: requestId
      // [...]: chunkIndex (4字节)
      // [...]: totalChunks (4字节)
      // [...]: 分块数据
      const headerSize = 8 + requestIdBytes.length + 8;
      const buffer = new ArrayBuffer(headerSize + chunkData.length);
      const view = new DataView(buffer);
      
      view.setUint32(0, 0, true); // 消息类型 = 0 (文件分块)
      view.setUint32(4, requestIdBytes.length, true);
      
      const uint8View = new Uint8Array(buffer);
      uint8View.set(requestIdBytes, 8);
      
      view.setUint32(8 + requestIdBytes.length, chunk.chunkIndex, true);
      view.setUint32(8 + requestIdBytes.length + 4, chunk.totalChunks, true);
      uint8View.set(chunkData, headerSize);
      
      channel.send(buffer);
      console.log(`✅ 通过DataChannel P2P发送分块 ${chunk.chunkIndex}, 大小: ${buffer.byteLength} bytes`);
    } catch (error) {
      console.error('❌ DataChannel 发送失败:', error);
      throw new Error(`P2P传输失败: ${error}`);
    }
  }
  
  /**
   * 处理接收到的文件分块（支持多线程）
   */
  async handleFileChunk(
    requestId: string,
    chunkIndex: number,
    data: number[],
    _isLast: boolean
  ): Promise<void> {
    try {
      const threadMatch = requestId.match(/-thread(\d+)$/);
      const isThreadRequest = threadMatch !== null;
      const threadId = isThreadRequest ? parseInt(threadMatch[1]) : 0;
      const parentRequestId = isThreadRequest ? requestId.replace(/-thread\d+$/, '') : requestId;

      const progress = this.transfers.get(parentRequestId);
      if (!progress) {
        console.warn('⚠️ 未找到传输记录:', parentRequestId);
        return;
      }

      const chunkData = new Uint8Array(data);

      if (isThreadRequest) {
        // 多线程下载：存储到线程缓冲区
        const threadBufferMap = this.threadBuffers.get(parentRequestId);
        if (threadBufferMap) {
          let threadBuffer = threadBufferMap.get(threadId);
          if (!threadBuffer) {
            // 如果线程缓冲区不存在，创建一个Map来存储分块
            threadBuffer = new Map<number, Uint8Array>();
            threadBufferMap.set(threadId, threadBuffer as any);
          }
          // 使用Map存储，key是chunkIndex，value是数据
          (threadBuffer as any).set(chunkIndex, chunkData);
        }
      } else {
        // 单文件下载：存储到下载缓冲区
        const buffer = this.downloadBuffers.get(parentRequestId);
        if (buffer) {
          buffer[chunkIndex] = chunkData;
        }
      }

      progress.transferredSize += chunkData.length;
      progress.progress = Math.min((progress.transferredSize / progress.totalSize) * 100, 100);
      progress.status = 'transferring';

      const now = Date.now();
      const lastUpdate = this.lastProgressUpdate.get(parentRequestId);
      if (lastUpdate) {
        const timeDiff = (now - lastUpdate.time) / 1000;
        if (timeDiff >= 0.05) { // 极快的速度更新（0.05秒）
          const sizeDiff = progress.transferredSize - lastUpdate.size;
          progress.speed = sizeDiff / timeDiff;
          this.lastProgressUpdate.set(parentRequestId, { time: now, size: progress.transferredSize });
          
          // 触发进度回调
          if (this.onTransferProgressCallback) {
            this.onTransferProgressCallback(progress);
          }
        }
      }

      // 减少日志输出，避免影响性能
      if (chunkIndex % 50 === 0 || progress.progress >= 99) {
        console.log(
          `📦 ${isThreadRequest ? `[线程${threadId}] ` : ''}接收分块 ${chunkIndex + 1} (${progress.progress.toFixed(1)}%) 速度: ${this.formatSpeed(progress.speed)}`
        );
      }
    } catch (error) {
      console.error('❌ 处理文件分块失败:', error);
    }
  }

  /**
   * 处理传输完成
   */
  async handleTransferComplete(requestId: string): Promise<void> {
    try {
      // 检查是否是线程请求
      const threadMatch = requestId.match(/-thread(\d+)$/);
      if (threadMatch) {
        const threadId = parseInt(threadMatch[1]);
        const parentRequestId = requestId.replace(/-thread\d+$/, '');
        console.log(`✅ 线程 ${threadId} 传输完成`);

        const tracker = this.threadCompletionTrackers.get(parentRequestId);
        if (tracker) {
          tracker.completedThreads.add(threadId);
          console.log(`📊 已完成线程: ${tracker.completedThreads.size}/${tracker.totalThreads}`);

          if (tracker.completedThreads.size === tracker.totalThreads) {
            console.log('🎉 所有线程已完成，触发合并');
            tracker.resolve();
            this.threadCompletionTrackers.delete(parentRequestId);
          }
        }
        // 线程请求不需要继续处理，直接返回
        return;
      }

      // 单文件下载（非多线程）的处理逻辑
      console.log('✅ 单文件传输完成:', requestId);

      const progress = this.transfers.get(requestId);
      if (!progress) {
        console.warn('⚠️ 未找到传输记录:', requestId);
        return;
      }

      const buffer = this.downloadBuffers.get(requestId);
      if (!buffer) {
        throw new Error('下载缓冲区不存在');
      }

      let totalSize = 0;
      buffer.forEach(chunk => {
        totalSize += chunk.length;
      });

      const fileData = new Uint8Array(totalSize);
      let offset = 0;
      buffer.forEach(chunk => {
        fileData.set(chunk, offset);
        offset += chunk.length;
      });

      const savePath = (progress as any).savePath;
      if (!savePath) {
        throw new Error('保存路径不存在');
      }

      await invoke('write_file_bytes', {
        path: savePath,
        data: Array.from(fileData),
      });

      progress.status = 'completed';
      progress.progress = 100;

      this.downloadBuffers.delete(requestId);
      this.transferStartTimes.delete(requestId);
      this.lastProgressUpdate.delete(requestId);

      if (this.onTransferCompleteCallback) {
        this.onTransferCompleteCallback(requestId, savePath);
      }

      console.log('✅ 文件已保存:', savePath);
    } catch (error) {
      console.error('❌ 处理传输完成失败:', error);
      this.handleTransferError(requestId, String(error));
    }
  }

  /**
   * 合并线程数据
   */
  private async mergeThreadData(requestId: string, threadCount: number, savePath: string): Promise<void> {
    try {
      console.log('🔗 开始合并线程数据...');

      const threadBufferMap = this.threadBuffers.get(requestId);
      if (!threadBufferMap) {
        throw new Error('线程缓冲区不存在');
      }

      // 按线程ID顺序合并数据
      const allChunks: Uint8Array[] = [];
      for (let threadId = 0; threadId < threadCount; threadId++) {
        const threadBuffer = threadBufferMap.get(threadId);
        if (!threadBuffer) {
          throw new Error(`线程 ${threadId} 的缓冲区不存在`);
        }
        
        // 按分块索引排序
        const sortedChunks = Array.from(threadBuffer.entries())
          .sort((a, b) => a[0] - b[0])
          .map(entry => entry[1]);
        
        allChunks.push(...sortedChunks);
      }

      console.log(`📦 合并 ${allChunks.length} 个数据块`);

      let totalSize = 0;
      allChunks.forEach(chunk => {
        totalSize += chunk.length;
      });

      console.log(`📊 总大小: ${this.formatSize(totalSize)}`);

      const fileData = new Uint8Array(totalSize);
      let offset = 0;
      allChunks.forEach(chunk => {
        fileData.set(chunk, offset);
        offset += chunk.length;
      });

      console.log('💾 正在保存文件...');
      await invoke('write_file_bytes', {
        path: savePath,
        data: Array.from(fileData),
      });

      const progress = this.transfers.get(requestId);
      if (progress) {
        progress.status = 'completed';
        progress.progress = 100;
        progress.transferredSize = totalSize;
        
        // 触发最后一次进度更新
        if (this.onTransferProgressCallback) {
          this.onTransferProgressCallback(progress);
        }
      }

      // 清理资源
      this.threadBuffers.delete(requestId);
      this.transferStartTimes.delete(requestId);
      this.lastProgressUpdate.delete(requestId);

      // 触发完成回调
      if (this.onTransferCompleteCallback) {
        this.onTransferCompleteCallback(requestId, savePath);
      }

      console.log('✅ 多线程下载完成，文件已保存:', savePath);
    } catch (error) {
      console.error('❌ 合并线程数据失败:', error);
      this.handleTransferError(requestId, String(error));
      throw error;
    }
  }

  /**
   * 处理传输错误
   */
  handleTransferError(requestId: string, error: string): void {
    console.error('❌ 文件传输错误:', error);

    const progress = this.transfers.get(requestId);
    if (progress) {
      progress.status = 'failed';
      progress.error = error;

      if (this.onTransferErrorCallback) {
        this.onTransferErrorCallback(requestId, error);
      }
    }

    this.downloadBuffers.delete(requestId);
    this.threadBuffers.delete(requestId);
    this.threadCompletionTrackers.delete(requestId);
    this.transferStartTimes.delete(requestId);
    this.lastProgressUpdate.delete(requestId);
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    } else if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    } else {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
  }

  /**
   * 格式化传输速度
   */
  private formatSpeed(bytesPerSecond: number): string {
    if (bytesPerSecond < 1024) {
      return `${bytesPerSecond.toFixed(0)} B/s`;
    } else if (bytesPerSecond < 1024 * 1024) {
      return `${(bytesPerSecond / 1024).toFixed(2)} KB/s`;
    } else {
      return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
    }
  }

  private sendTransferResponse(requestId: string, to: string, accepted: boolean): void {
    if (!this.websocket) return;

    const message: FileShareSignalingMessage = {
      type: 'file-transfer-response',
      from: this.localPlayerId,
      to,
      request: { requestId } as any,
      accepted,
    };

    this.websocket.send(JSON.stringify(message));
  }

  private sendTransferComplete(requestId: string, to: string): void {
    // 必须使用 DataChannel
    const channel = this.dataChannels.get(to);
    
    if (!channel || channel.readyState !== 'open') {
      console.error('❌ DataChannel不可用，无法发送传输完成消息');
      throw new Error('P2P连接不可用');
    }
    
    try {
      const requestIdBytes = new TextEncoder().encode(requestId);
      const buffer = new ArrayBuffer(8 + requestIdBytes.length);
      const view = new DataView(buffer);
      
      view.setUint32(0, 1, true); // 消息类型 = 1 (传输完成)
      view.setUint32(4, requestIdBytes.length, true);
      
      const uint8View = new Uint8Array(buffer);
      uint8View.set(requestIdBytes, 8);
      
      channel.send(buffer);
      console.log(`✅ 通过DataChannel发送传输完成消息`);
    } catch (error) {
      console.error('❌ DataChannel 发送完成消息失败:', error);
      throw new Error(`发送完成消息失败: ${error}`);
    }
  }

  private sendTransferError(requestId: string, to: string, error: string): void {
    // 必须使用 DataChannel
    const channel = this.dataChannels.get(to);
    
    if (!channel || channel.readyState !== 'open') {
      console.error('❌ DataChannel不可用，无法发送传输错误消息');
      // 错误消息发送失败不抛出异常，避免二次错误
      return;
    }
    
    try {
      const requestIdBytes = new TextEncoder().encode(requestId);
      const errorBytes = new TextEncoder().encode(error);
      const buffer = new ArrayBuffer(8 + requestIdBytes.length + errorBytes.length);
      const view = new DataView(buffer);
      
      view.setUint32(0, 2, true); // 消息类型 = 2 (传输错误)
      view.setUint32(4, requestIdBytes.length, true);
      
      const uint8View = new Uint8Array(buffer);
      uint8View.set(requestIdBytes, 8);
      uint8View.set(errorBytes, 8 + requestIdBytes.length);
      
      channel.send(buffer);
      console.log(`✅ 通过DataChannel发送传输错误消息`);
    } catch (err) {
      console.error('❌ DataChannel 发送错误消息失败:', err);
    }
  }

  cancelTransfer(requestId: string): void {
    console.log('🚫 取消传输:', requestId);

    const progress = this.transfers.get(requestId);
    if (progress) {
      progress.status = 'cancelled';
    }

    this.transfers.delete(requestId);
    this.downloadBuffers.delete(requestId);
    this.threadBuffers.delete(requestId);
    this.threadCompletionTrackers.delete(requestId);
    this.transferStartTimes.delete(requestId);
    this.lastProgressUpdate.delete(requestId);
    this.activeDownloads.delete(requestId);
  }

  getTransferProgress(requestId: string): FileTransferProgress | undefined {
    return this.transfers.get(requestId);
  }

  getAllTransfers(): FileTransferProgress[] {
    return Array.from(this.transfers.values());
  }

  onTransferProgress(callback: (progress: FileTransferProgress) => void): void {
    this.onTransferProgressCallback = callback;
  }

  onTransferComplete(callback: (requestId: string, filePath: string) => void): void {
    this.onTransferCompleteCallback = callback;
  }

  onTransferError(callback: (requestId: string, error: string) => void): void {
    this.onTransferErrorCallback = callback;
  }

  cleanup(): void {
    console.log('🧹 清理文件传输服务...');
    this.transfers.clear();
    this.downloadBuffers.clear();
    this.threadBuffers.clear();
    this.threadCompletionTrackers.clear();
    this.transferStartTimes.clear();
    this.lastProgressUpdate.clear();
    this.activeDownloads.clear();
    this.downloadQueue = [];
    this.websocket = null;
    console.log('✅ 文件传输服务已清理');
  }
}

export const fileTransferService = new FileTransferService();
