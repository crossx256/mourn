//! What a window close request means for the whole application.
//!
//! Why this is a separate, pure decision: the app declares TWO real webview windows
//! (`main` and the hidden `tray-menu`). The Tauri runtime only reports "last window
//! gone" when its window registry becomes empty, so destroying `main` while the
//! tray window survives never ended the process -- exactly the reported Linux
//! zombie — while `restore_main_window` could never bring `main` back because the
//! single-instance owner acknowledges the new launch and exits.
//!
//! The policy makes closing `main` an application exit, and keeps the Windows
//! stay-minimized behaviour (hide instead).

/// Which window the request is about. Only these two labels exist in tauri.conf.json.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowRole {
    /// The one window the user works in.
    Main,
    /// The hidden tray popup (a tool window, never a quit target).
    TrayMenu,
    /// Anything else that might be added later: a plain close.
    Auxiliary,
}

pub fn window_role(label: &str) -> WindowRole {
    match label {
        "main" => WindowRole::Main,
        "tray-menu" => WindowRole::TrayMenu,
        _ => WindowRole::Auxiliary,
    }
}

pub fn is_last_window(label: &str) -> bool {
    matches!(window_role(label), WindowRole::Main)
}

/// What the close handler should do with the request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    /// Let the runtime destroy the window.
    AllowClose,
    /// Keep the window alive and hide it (stay-minimized / tray popup).
    HideWindow,
    /// Keep the window alive, hide the tray popup.
    PreventAndHide,
    /// End the whole process (`AppHandle::exit`), whatever other windows remain.
    ExitApplication,
}

/// One close request, reduced to the facts the decision depends on.
#[derive(Debug, Clone, Copy)]
pub struct CloseRequest {
    pub label: WindowRole,
    /// "Stay minimized (close to tray)" - Windows only, option off by default.
    pub stay_minimized: bool,
    /// The user asked to close for real (title-bar X, Alt+F4 / WM close, tray quit)
    /// rather than an incidental close the app may turn into a hide.
    pub explicit: bool,
}

impl CloseRequest {
    pub fn decide(&self) -> CloseAction {
        match self.label {
            // The tray popup is a tool window of a running app. Closing it is a
            // dismissal, never a quit, and destroying it would leave the tray with
            // no menu to show.
            WindowRole::TrayMenu => CloseAction::PreventAndHide,
            // THE Zombie fix: `main` is the application. Destroying it while the
            // tray window survives never ends the Tauri process (the runtime only
            // reports "last window gone" when its registry empties), so closing it
            // exits explicitly. This holds on every platform, with or without
            // stay-minimized: an explicit close is a user asking to quit.
            WindowRole::Main => {
                if self.stay_minimized && !self.explicit {
                    CloseAction::HideWindow
                } else {
                    CloseAction::ExitApplication
                }
            }
            WindowRole::Auxiliary => CloseAction::AllowClose,
        }
    }

    /// True when the process is meant to keep running behind this request.
    pub fn keep_running(&self) -> bool {
        !matches!(self.decide(), CloseAction::ExitApplication)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_main_is_the_app_window() {
        assert!(is_last_window("main"));
        assert!(!is_last_window("tray-menu"));
        assert!(!is_last_window("other"));
    }
    #[test]
    fn roles_are_explicit() {
        assert_eq!(window_role("main"), WindowRole::Main);
        assert_eq!(window_role("tray-menu"), WindowRole::TrayMenu);
        assert_eq!(window_role("chat"), WindowRole::Auxiliary);
    }
}

// Regression: closing the main window while the hidden tray-menu window still
// exists must end the whole application, not only destroy `main`.
#[cfg(test)]
mod close_request_tests {
    use super::*;

    fn request(label: &str, stay_minimized: bool, explicit: bool) -> CloseRequest {
        CloseRequest {
            label: window_role(label),
            stay_minimized,
            explicit,
        }
    }

    #[test]
    fn closing_main_ends_the_app_while_tray_menu_survives() {
        // With tray-menu alive the runtime's window registry never empties, so the
        // process would keep running with no main window: the reported zombie.
        assert_eq!(request("main", false, false).decide(), CloseAction::ExitApplication);
    }

    #[test]
    fn closing_main_ends_the_app_without_other_windows_too() {
        assert_eq!(request("main", false, false).decide(), CloseAction::ExitApplication);
    }

    #[test]
    fn stay_minimized_hides_main_instead_of_exiting() {
        assert_eq!(request("main", true, false).decide(), CloseAction::HideWindow);
        assert_eq!(request("main", true, false).keep_running(), true);
    }

    #[test]
    fn an_explicit_close_ends_the_app_even_with_stay_minimized() {
        // The title bar decides hiding itself and calls plugin:window|close; an
        // explicit close from the UI (or a WM gesture the frontend reports) quits.
        assert_eq!(request("main", true, true).decide(), CloseAction::ExitApplication);
    }

    #[test]
    fn the_tray_menu_window_never_ends_the_app() {
        for stay in [false, true] {
            for explicit in [false, true] {
                assert_eq!(request("tray-menu", stay, explicit).decide(), CloseAction::PreventAndHide);
            }
        }
    }

    #[test]
    fn an_auxiliary_window_is_plainly_closed() {
        assert_eq!(request("some-future-window", false, false).decide(), CloseAction::AllowClose);
    }
}
