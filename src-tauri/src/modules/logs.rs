//! Bounded log reads, independent of Tauri and the UI.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

pub const MAX_LOG_BYTES: usize = 512 * 1024;
const TRUNCATION_NOTICE: &str = "[仅显示最近 512 KB 日志]\n";

pub fn read_recent_log(path: &Path) -> io::Result<String> {
    read_tail(&mut File::open(path)?)
}

fn read_tail(reader: &mut (impl Read + Seek)) -> io::Result<String> {
    let size = reader.seek(SeekFrom::End(0))?;
    let start = size.saturating_sub(MAX_LOG_BYTES as u64);
    reader.seek(SeekFrom::Start(start))?;

    // Bound the read even if the running application appends more log entries.
    let mut bytes = Vec::with_capacity(size.min(MAX_LOG_BYTES as u64) as usize);
    reader.take(MAX_LOG_BYTES as u64).read_to_end(&mut bytes)?;
    let content = String::from_utf8_lossy(&bytes);
    if start > 0 {
        Ok(format!("{TRUNCATION_NOTICE}{content}"))
    } else {
        Ok(content.into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn empty_and_short_logs_have_no_truncation_notice() {
        assert_eq!(read_tail(&mut Cursor::new(Vec::<u8>::new())).unwrap(), "");
        assert_eq!(
            read_tail(&mut Cursor::new(b"first\nlast\n")).unwrap(),
            "first\nlast\n"
        );
    }

    #[test]
    fn exact_limit_is_not_marked_as_truncated() {
        let bytes = vec![b'a'; MAX_LOG_BYTES];
        let result = read_tail(&mut Cursor::new(&bytes)).unwrap();
        assert_eq!(result.as_bytes(), bytes);
    }

    #[test]
    fn large_logs_keep_only_the_latest_bytes() {
        let mut bytes = vec![b'a'; MAX_LOG_BYTES + 123];
        bytes.extend_from_slice(b"last entry\n");
        let expected = &bytes[bytes.len() - MAX_LOG_BYTES..];

        let result = read_tail(&mut Cursor::new(&bytes)).unwrap();
        let body = result.strip_prefix(TRUNCATION_NOTICE).unwrap();
        assert_eq!(body.as_bytes(), expected);
    }

    #[test]
    fn invalid_utf8_and_split_characters_keep_legacy_lossy_decoding() {
        assert_eq!(
            read_tail(&mut Cursor::new([b'a', 0xff, b'b'])).unwrap(),
            "a\u{fffd}b"
        );

        let mut bytes = "中".as_bytes().to_vec();
        bytes.extend(vec![b'a'; MAX_LOG_BYTES - 1]);
        let result = read_tail(&mut Cursor::new(bytes)).unwrap();
        assert!(result.starts_with(&format!("{TRUNCATION_NOTICE}\u{fffd}")));
    }

    #[test]
    fn reader_never_reads_more_than_the_limit() {
        struct CountedReader {
            cursor: Cursor<Vec<u8>>,
            bytes_read: usize,
        }
        impl Read for CountedReader {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                let count = self.cursor.read(buffer)?;
                self.bytes_read += count;
                Ok(count)
            }
        }
        impl Seek for CountedReader {
            fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
                self.cursor.seek(position)
            }
        }
        let mut reader = CountedReader {
            cursor: Cursor::new(vec![b'a'; MAX_LOG_BYTES * 4]),
            bytes_read: 0,
        };

        read_tail(&mut reader).unwrap();
        assert_eq!(reader.bytes_read, MAX_LOG_BYTES);
    }

    #[test]
    fn file_errors_are_not_hidden() {
        let path = std::env::temp_dir().join(format!(
            "mctier-missing-log-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        assert_eq!(
            read_recent_log(&path).unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
    }
}
