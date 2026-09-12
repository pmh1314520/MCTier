use std::path::Path;

pub const LEGACY_RULES: [&str; 6] = [
    "MCTier-in",
    "MCTier-out",
    "MCTier-EasyTier-in",
    "MCTier-EasyTier-out",
    "MCTier-Overlay-TCP-In",
    "MCTier-Overlay-ICMP-In",
];
pub const RULE_NAMES: [&str; 6] = [
    "MCTier-App-In-v2",
    "MCTier-App-Out-v2",
    "MCTier-EasyTier-In-v2",
    "MCTier-EasyTier-Out-v2",
    "MCTier-Overlay-TCP-In-v2",
    "MCTier-Overlay-ICMP-In-v2",
];
const OVERLAY: &str = "10.126.126.0/24";

pub struct Rule {
    pub name: &'static str,
    pub arguments: Vec<String>,
}

pub fn rules(app: &Path, easytier: &Path) -> Vec<Rule> {
    let mut result = Vec::new();
    for (index, program, direction) in [
        (0, app, "in"),
        (1, app, "out"),
        (2, easytier, "in"),
        (3, easytier, "out"),
    ] {
        let mut arguments = vec![
            format!("dir={direction}"),
            "action=allow".into(),
            format!("program={}", program.display()),
            "enable=yes".into(),
            "profile=any".into(),
        ];
        if index == 0 {
            // Loopback is needed by the local privilege broker; overlay services
            // must never grant inbound access to physical-interface addresses.
            let addresses = format!("{OVERLAY},127.0.0.1,::1");
            arguments.extend([
                format!("localip={addresses}"),
                format!("remoteip={addresses}"),
            ]);
        }
        result.push(Rule {
            name: RULE_NAMES[index],
            arguments,
        });
    }
    for (index, protocol) in [(4, "TCP"), (5, "icmpv4:8,any")] {
        let mut arguments = vec![
            "dir=in".into(),
            "action=allow".into(),
            format!("protocol={protocol}"),
            "enable=yes".into(),
            "profile=any".into(),
            format!("localip={OVERLAY}"),
            format!("remoteip={OVERLAY}"),
        ];
        if index == 4 {
            arguments.extend([
                "localport=14539,14540".into(),
                format!("program={}", app.display()),
            ]);
        }
        result.push(Rule {
            name: RULE_NAMES[index],
            arguments,
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_rules_constrain_both_endpoints_and_do_not_open_other_programs_ports() {
        let rules = rules(Path::new("app.exe"), Path::new("easytier.exe"));
        assert_eq!(rules.len(), RULE_NAMES.len());
        for index in [0, 4, 5] {
            let args = &rules[index].arguments;
            assert!(args
                .iter()
                .any(|arg| arg.starts_with("localip=10.126.126.0/24")));
            assert!(args
                .iter()
                .any(|arg| arg.starts_with("remoteip=10.126.126.0/24")));
        }
        assert!(rules[4].arguments.contains(&"program=app.exe".into()));
        assert!(rules[4].arguments.contains(&"localport=14539,14540".into()));
        assert!(rules[5].arguments.contains(&"protocol=icmpv4:8,any".into()));
        assert!(rules[0]
            .arguments
            .contains(&"localip=10.126.126.0/24,127.0.0.1,::1".into()));
    }

    #[test]
    fn easytier_transport_and_app_outbound_keep_wan_access_on_all_profiles() {
        let rules = rules(Path::new("app.exe"), Path::new("easytier.exe"));
        for index in [1, 2, 3] {
            assert!(rules[index].arguments.contains(&"profile=any".into()));
            assert!(!rules[index]
                .arguments
                .iter()
                .any(|arg| arg.starts_with("localip=") || arg.starts_with("remoteip=")));
        }
        for rule in rules {
            assert!(!LEGACY_RULES.contains(&rule.name));
        }
    }
}
