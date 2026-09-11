use super::virtual_network::virtual_host;

pub const MAX_HOSTS_BYTES: usize = 1024 * 1024;

pub fn validate_hosts_update(old: &str, new: &str) -> Result<(), String> {
    if old.len() > MAX_HOSTS_BYTES || new.len() > MAX_HOSTS_BYTES {
        return Err("hosts content exceeds limit".into());
    }
    if outside_section(old, false)? != outside_section(new, true)? {
        return Err("only the MCTier hosts section may be modified".into());
    }
    Ok(())
}

fn outside_section(content: &str, validate: bool) -> Result<Vec<&str>, String> {
    let mut outside = Vec::new();
    let mut inside = false;
    for line in content.lines() {
        if line == "# MCTier Magic DNS End" {
            if !inside {
                return Err("orphan hosts end marker".into());
            }
            inside = false;
        } else if line.starts_with("# MCTier Magic DNS - ") {
            if inside {
                return Err("nested hosts marker".into());
            }
            inside = true;
        } else if !inside {
            outside.push(line);
        } else if validate && !line.trim().is_empty() {
            if line
                .chars()
                .any(|c| c == '#' || (c.is_control() && c != '\t'))
            {
                return Err("invalid hosts entry characters".into());
            }
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 2
                || virtual_host(fields[0]).is_none()
                || !fields[1..].iter().all(|host| is_mctier_domain(host))
            {
                return Err("hosts entries require a virtual IP and *.mct.net domains".into());
            }
        }
    }
    if inside {
        return Err("unclosed hosts marker".into());
    }
    Ok(outside)
}

fn is_mctier_domain(value: &str) -> bool {
    if value.len() > 253 {
        return false;
    }
    let lower = value.to_ascii_lowercase();
    let Some(prefix) = lower.strip_suffix(".mct.net") else {
        return false;
    };
    !prefix.is_empty()
        && prefix.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hosts(entry: &str) -> String {
        format!("127.0.0.1 localhost\n# MCTier Magic DNS - test\n{entry}\n# MCTier Magic DNS End\n")
    }
    #[test]
    fn permits_virtual_updates_and_removal_but_preserves_other_entries() {
        let old = hosts("10.126.126.1 a.mct.net");
        assert!(validate_hosts_update(&old, &hosts("10.126.126.2\tb.mct.net")).is_ok());
        assert!(validate_hosts_update(&old, "127.0.0.1 localhost\n").is_ok());
        assert!(validate_hosts_update(&old, &old.replace("localhost", "evil.com")).is_err());
        for entry in [
            "127.0.0.1 a.mct.net",
            "10.126.126.1 github.com",
            "10.126.126.1 a.mct.net.evil.com",
            "10.126.126.1",
            "10.126.126.1 a.mct.net # injected",
        ] {
            assert!(validate_hosts_update(&old, &hosts(entry)).is_err());
        }
    }
    #[test]
    fn rejects_malformed_sections_and_preserves_lines_after_end_marker() {
        let old = format!(
            "{}1.2.3.4 existing.example\n",
            hosts("10.126.126.1 a.mct.net")
        );
        assert!(
            validate_hosts_update(&old, &old.replace("existing.example", "attacker.example"))
                .is_err()
        );
        for bad in [
            "# MCTier Magic DNS End\n",
            "# MCTier Magic DNS - x\n",
            "# MCTier Magic DNS - x\n# MCTier Magic DNS - y\n",
        ] {
            assert!(validate_hosts_update("", bad).is_err());
        }
    }
}
