# IF-VIP Project 🚀

A Windows desktop (Electron) app + Node.js/Express/PostgreSQL backend implementing the
full IF-VIP authentication and licensing flow:

```
WELCOME → SIGN UP → LOGIN → ACTIVATION CODE → DASHBOARD
```

## 📂 Project Structure
```text
if-vip-main/
├── Backend/
│   ├── .env                 # local dev config (NOT for production — replace secrets)
│   ├── .env.example         # template, safe to commit
│   ├── middleware/
│   │   ├── authMiddleware.js   # verifies JWT on every protected route
│   │   └── rateLimiter.js      # brute-force protection for login/activation
│   ├── authController.js    # register / login / session check / logout
│   ├── licenseController.js # activation, license status, admin license generation
│   ├── db.js                 # PostgreSQL connection + table bootstrap
│   ├── server.js              # Express app + route wiring
│   └── package.json
└── Client/
    ├── Assets/
    │   ├── logo.png          # IF-VIP brand logo
    │   └── theme.css         # shared dark/gaming theme used by every screen
    ├── Authentication/
    │   ├── session.js        # token storage + authenticated fetch + entry-screen resolver
    │   ├── welcome.html
    │   ├── signup.html
    │   ├── login.html
    │   ├── forgot-password.html
    │   ├── activation.html
    │   ├── activation-success.html
    │   ├── expired.html
    │   └── revoked.html
    ├── Core/
    │   ├── main.js            # Electron main process + centralized screen routing
    │   └── dashboard.html
    └── package.json
```

## Setup

### Backend
```bash
cd Backend
npm install
cp .env.example .env   # then fill in a real DATABASE_URL and JWT_SECRET
npm start
```
The server auto-creates the `users` and `licenses` tables on first run.

To generate a license key for testing (normally an admin-only action):
```bash
curl -X POST http://localhost:5000/api/license/generate \
  -H "Content-Type: application/json" \
  -d '{"licenseType":"1 Month","durationDays":30}'
```

### Client (Electron app)
```bash
cd Client
npm install
npm start
```

## Flow implemented

- **First launch**: `welcome.html` — checks for a saved session token and, if valid, resolves
  online (via `/api/auth/me` + `/api/license/status`) straight to the right screen instead of
  making the user click through again.
- **Sign Up**: creates the account, hashes the password (bcrypt), then sends the user back to
  **Login** — it does not auto-open the dashboard.
- **Login**: on success, stores a JWT (never the password) and immediately re-checks license
  status with the server before deciding where to go next.
- **Activation**: license keys are validated server-side only (never hardcoded client-side).
  Rate-limited to slow brute-force guessing.
- **Expired / Revoked**: dedicated screens that lock premium functionality and route back to
  activation or logout — the client never trusts a locally cached expiration date; every check
  hits `/api/license/status`.
- **Dashboard**: only reachable after the server confirms an active license. Re-validates the
  session on every load.
- **Logout**: clears the local token only; the account and license activation stay intact.

## Known gaps / next steps
- Aim Trainer, Recoil Trainer, Mouse Center, AI Coach, Sensitivity Calculator, and CrossFire
  process detection are scaffolded in the sidebar but not yet implemented — they currently show
  a "not wired up yet" placeholder rather than fake data.
- Password reset requires an SMTP provider to be configured; the UI is in place but honestly
  reports that emails aren't sent yet.
- The Admin Panel described in the original spec is not part of this update — this pass covers
  the client/backend auth + license flow only.
