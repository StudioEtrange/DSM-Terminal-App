<p align="center">
  <h1 align="center">DSM Terminal App</h1>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/6315edeb-122f-4fc3-8ada-5b30e6f3824e" alt="DSM Terminal Screenshot" width="80%" />
</p>

<p align="center">
  A terminal emulator for Synology DSM
</p>

---

## Features
- Multi-window support
- Open a login shell as the current DSM user

---

## Notes
The package installs a passwordless sudo rule for `sc-dsm-terminal` so it can
open a login shell as any DSM user. The rule is removed when the package is
uninstalled.

---

## Requirements
- Python

---

## Disclaimer
- This project is provided “as is” without any warranty or guarantees
- Use at your own risk, especially when enabling `sudo` or modifying system permissions
- The author is not responsible for any damage, data loss, or misconfiguration resulting from use of this software
- Not affiliated with or endorsed by Synology
