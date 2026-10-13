//! Native Task Scheduler COM integration. No shell, script host, password or UAC prompt.
use std::path::Path;
use windows::{
    core::{Interface, BSTR, PWSTR, VARIANT},
    Win32::{
        Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL},
        Security::{
            Authorization::ConvertSidToStringSidW, GetTokenInformation, TokenUser, TOKEN_QUERY,
            TOKEN_USER,
        },
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_MULTITHREADED,
            },
            TaskScheduler::*,
            Threading::{GetCurrentProcess, OpenProcessToken},
        },
    },
};

const MARKER: &str = "MCTier Quark daily background transfer v1";
const ARGUMENT: &str = "--quark-background";
type Result<T> = windows::core::Result<T>;
struct Apartment;
impl Apartment {
    fn new() -> Result<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        }
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}
struct Token(HANDLE);
impl Drop for Token {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

fn current_sid() -> Result<String> {
    unsafe {
        let mut token = Token(HANDLE::default());
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token.0)?;
        let mut size = 0;
        let _ = GetTokenInformation(token.0, TokenUser, None, 0, &mut size);
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        GetTokenInformation(
            token.0,
            TokenUser,
            Some(buffer.as_mut_ptr().cast()),
            size,
            &mut size,
        )?;
        let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
        let mut sid = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut sid)?;
        let value = sid.to_string();
        let _ = LocalFree(HLOCAL(sid.0.cast()));
        Ok(value?)
    }
}
fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn definition(sid: &str, exe: &Path) -> String {
    let start = chrono::Utc::now()
        .with_timezone(&chrono::FixedOffset::east_opt(8 * 3600).unwrap())
        .format("%Y-%m-%dT00:05:00+08:00")
        .to_string();
    let user = xml(sid);
    let command = xml(&exe.to_string_lossy());
    let directory = xml(&exe.parent().unwrap_or(Path::new(".")).to_string_lossy());
    format!(
        r#"<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>{MARKER}</Description></RegistrationInfo>
<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>{user}</UserId></LogonTrigger>
<CalendarTrigger><StartBoundary>{start}</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
<Principals><Principal id="Author"><UserId>{user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><Enabled>true</Enabled><Hidden>true</Hidden><RunOnlyIfIdle>false</RunOnlyIfIdle><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT3M</ExecutionTimeLimit><Priority>10</Priority><RestartOnFailure><Interval>PT15M</Interval><Count>96</Count></RestartOnFailure></Settings>
<Actions Context="Author"><Exec><Command>{command}</Command><Arguments>{ARGUMENT}</Arguments><WorkingDirectory>{directory}</WorkingDirectory></Exec></Actions></Task>"#
    )
}
struct Scheduler {
    service: ITaskService,
    root: ITaskFolder,
}
impl Scheduler {
    fn connect() -> Result<Self> {
        unsafe {
            let service: ITaskService =
                CoCreateInstance(&TaskScheduler, None, CLSCTX_INPROC_SERVER)?;
            let empty = VARIANT::default();
            service.Connect(&empty, &empty, &empty, &empty)?;
            let root = service.GetFolder(&BSTR::from("\\"))?;
            Ok(Self { service, root })
        }
    }
    fn register(&self, name: &str, sid: &str, exe: &Path) -> Result<()> {
        unsafe {
            let task = self.service.NewTask(0)?;
            task.SetXmlText(&BSTR::from(definition(sid, exe)))?;
            let empty = VARIANT::default();
            self.root.RegisterTaskDefinition(
                &BSTR::from(name),
                &task,
                TASK_CREATE_OR_UPDATE.0,
                &VARIANT::from(sid),
                &empty,
                TASK_LOGON_INTERACTIVE_TOKEN,
                &empty,
            )?;
            Ok(())
        }
    }
    fn remove(&self, name: &str) -> Result<()> {
        unsafe {
            match self.root.DeleteTask(&BSTR::from(name), 0) {
                Err(error) if error.code().0 as u32 == 0x80070002 => Ok(()),
                result => result,
            }
        }
    }
    fn uninstall(&self, exe: &Path) -> Result<()> {
        unsafe {
            let tasks = self.root.GetTasks(TASK_ENUM_HIDDEN.0)?;
            let mut names = Vec::new();
            for index in 1..=tasks.Count()? {
                let task = tasks.get_Item(&VARIANT::from(index))?;
                let name = task.Name()?.to_string();
                if !name.starts_with("MCTier-QuarkDaily-") {
                    continue;
                }
                let definition = task.Definition()?;
                let mut description = BSTR::new();
                definition
                    .RegistrationInfo()?
                    .Description(&mut description)?;
                if description.to_string() != MARKER {
                    continue;
                }
                let actions = definition.Actions()?;
                let mut count = 0;
                actions.Count(&mut count)?;
                if count != 1 {
                    continue;
                }
                let action: IExecAction = actions.get_Item(1)?.cast()?;
                let mut action_path = BSTR::new();
                let mut arguments = BSTR::new();
                action.Path(&mut action_path)?;
                action.Arguments(&mut arguments)?;
                if !action_path
                    .to_string()
                    .eq_ignore_ascii_case(&exe.to_string_lossy())
                    || arguments.to_string() != ARGUMENT
                {
                    continue;
                }
                task.Stop(0)?;
                names.push(name);
            }
            for name in names {
                self.remove(&name)?;
            }
            Ok(())
        }
    }
}
pub(super) fn configure(enabled: bool, uninstall: bool) -> std::result::Result<(), String> {
    let exe = std::env::current_exe().map_err(|_| "无法定位夸克后台程序")?;
    let operation = || -> Result<()> {
        let _apartment = Apartment::new()?;
        let scheduler = Scheduler::connect()?;
        if uninstall {
            return scheduler.uninstall(&exe);
        }
        let sid = current_sid()?;
        let name = format!("MCTier-QuarkDaily-{sid}");
        if enabled {
            scheduler.register(&name, &sid, &exe)
        } else {
            scheduler.remove(&name)
        }
    };
    operation().map_err(|error| {
        format!(
            "Windows 后台任务配置失败（0x{:08X}），请检查任务计划程序或系统策略；将自动重试",
            error.code().0 as u32
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn task_definition_escapes_paths_and_has_no_periodic_polling() {
        let text = definition("S-1-5-21-1", Path::new("C:\\测试 & space\\mctier.exe"));
        assert!(text.contains("测试 &amp; space"));
        assert!(!text.contains("<Repetition>"));
        assert!(text.contains("<Priority>10</Priority>"));
        assert!(text.contains("<Interval>PT15M</Interval>"));
        assert!(text.contains("00:05:00+08:00"));
    }
    #[test]
    #[ignore = "Creates a uniquely named temporary task, driven by test-quark-background.ps1"]
    fn native_scheduler_probe() {
        let name = std::env::var("MCTIER_TEST_TASK_NAME").unwrap();
        assert!(name.starts_with("MCTier-QuarkTest-"));
        let exe = std::path::PathBuf::from(std::env::var_os("MCTIER_TEST_TASK_EXE").unwrap());
        let _apartment = Apartment::new().unwrap();
        let scheduler = Scheduler::connect().unwrap();
        if std::env::var("MCTIER_TEST_TASK_MODE").unwrap() == "remove" {
            scheduler.remove(&name).unwrap();
        } else {
            scheduler
                .register(&name, &current_sid().unwrap(), &exe)
                .unwrap();
        }
    }
}
