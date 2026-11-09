//! Keep established native storage stable and isolate the Flatpak client.

const NATIVE_APPLICATION_ID: &str = "bio.mourn.desktop";

pub fn application_id() -> &'static str {
    option_env!("MOURN_FLATPAK_APP_ID").unwrap_or(NATIVE_APPLICATION_ID)
}

pub fn keyring_service(base: &str) -> String {
    keyring_service_for(application_id(), base)
}

fn keyring_service_for(application_id: &str, base: &str) -> String {
    if application_id == NATIVE_APPLICATION_ID {
        base.to_owned()
    } else {
        format!("{application_id}:{base}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_only_the_build_time_identity() {
        let expected = option_env!("MOURN_FLATPAK_APP_ID").unwrap_or("bio.mourn.desktop");
        assert_eq!(application_id(), expected);
    }

    #[test]
    fn native_keychain_names_remain_unchanged() {
        for service in [
            "mourn-desktop",
            "mourn-desktop-accounts-v2",
            "mourn-desktop-internal-v2",
        ] {
            assert_eq!(keyring_service_for("bio.mourn.desktop", service), service);
        }
    }

    #[test]
    fn flatpak_credentials_and_internal_keys_do_not_share_native_slots() {
        let account = keyring_service_for("bio.mourn.newlife", "mourn-desktop-accounts-v2");
        let internal = keyring_service_for("bio.mourn.newlife", "mourn-desktop-internal-v2");
        assert_eq!(account, "bio.mourn.newlife:mourn-desktop-accounts-v2");
        assert_ne!(internal, "mourn-desktop-internal-v2");
        assert_ne!(account, internal);
    }
}
