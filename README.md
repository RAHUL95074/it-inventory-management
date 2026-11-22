# IT Inventory Management System

A responsive, online-ready IT asset inventory application built with Node.js, Express, EJS, HTML, CSS, JavaScript and MySQL.

## Features
- User self-registration (new accounts are always `user`)
- Login/logout with bcrypt password hashing and server-side sessions stored in MySQL
- Roles: admin, engineer, user
- Dashboard totals and location summary
- Asset create, edit, delete (delete is admin-only), search and status tracking
- Admin user management: promote/demote roles and activate/deactivate accounts
- Login rate limiting, Helmet security headers, parameterized SQL queries

## Requirements
- Node.js 20 or newer
- MySQL 8 (or compatible MySQL server)
- HTTPS in production

## 1. Create the database
Import `database.sql` into your MySQL server using phpMyAdmin, MySQL Workbench, or:

```bash
mysql -u root -p < database.sql
```

Create a dedicated database user and grant access (run as a MySQL administrator):

```sql
CREATE USER 'it_inventory_user'@'localhost' IDENTIFIED BY 'use-a-strong-unique-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX ON it_inventory.* TO 'it_inventory_user'@'localhost';
FLUSH PRIVILEGES;
```

If your hosting provider supplies a database hostname/user, use those values instead.

## 2. Configure the application
Copy `.env.example` to `.env` and fill in real values. Never upload `.env` to a public repository.

```bash
cp .env.example .env
```

Set `SESSION_SECRET` to a long random secret (32+ characters), and set `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` to the hosting provider's MySQL details. Set `APP_URL` to your HTTPS domain.

## 3. Install and run

```bash
npm install
npm start
```

The app listens on `PORT` (default 3000). Test `https://your-domain.com/health`; it should return `{"status":"ok","database":"connected"}`.

## 4. Create the first Admin
Self-registration intentionally cannot create Admin accounts. After importing the schema and configuring `.env`, run this once from the project directory:

```bash
npm run create-admin -- "IT Administrator" admin@yourcompany.com "Use-A-Strong-Password-Here"
```

Use the email/password to log in. Then open **Users** to change a registered user's role to Engineer or Admin. Do not expose the create-admin command as a web page.

## 5. Deploy to online hosting (recommended: Node.js-capable VPS or managed Node host)
1. Buy a domain and a hosting plan that explicitly supports long-running Node.js applications and a MySQL 8 database. Standard PHP-only/shared hosting generally cannot run this Node.js server.
2. Create a MySQL database and database user in the hosting control panel. Allow connections only from the application server where possible.
3. Upload the project folder (or deploy from a private Git repository) to the Node.js host.
4. Set the environment variables in the hosting dashboard. Do not commit or upload `.env` to a public Git repository.
5. Set the start command to `npm start` and Node version to 20+; install dependencies with `npm install`.
6. Import `database.sql` into the hosted database.
7. Run the one-time `npm run create-admin -- ...` command using the provider's terminal/SSH.
8. Attach your domain and enable the provider's HTTPS/TLS certificate. Set `NODE_ENV=production`, `APP_URL=https://your-domain.com`, and `PORT` as required by the provider.
9. Start/restart the app. Check `/health`, then register a normal User and test login, asset creation and role restrictions.
10. Configure automatic database backups and keep the OS, Node.js and dependencies updated.

### Hosting checklist
- [ ] Node.js 20+ application hosting (not PHP-only hosting)
- [ ] MySQL database created and credentials ready
- [ ] Database schema imported
- [ ] Environment variables configured securely
- [ ] Admin account created using terminal
- [ ] Domain connected and HTTPS enabled
- [ ] `/health` returns database connected
- [ ] Backups configured

## Important security and production notes
- Use HTTPS. Production session cookies are marked Secure when `NODE_ENV=production`.
- Use a unique strong `SESSION_SECRET`; keep all database credentials private.
- New signups receive only the `user` role. Admin privileges are assigned only through the CLI bootstrap or an existing Admin account.
- Use a trusted hosting provider, restrict database network access, enable backups, and test restore procedures.
- This is a starter application. Before handling sensitive corporate asset data at scale, add organization-specific audit logs, CSRF protection, password reset/email verification, MFA, stricter validation and a formal security review.
- The app uses server-rendered EJS templates; the interface is HTML/CSS and browser JavaScript. It does not require a separate frontend build step.

## Folder structure

```text
it-inventory-online/
├── database.sql
├── server.js
├── package.json
├── .env.example
├── README.md
├── scripts/
│   └── create-admin.js
├── public/
│   └── styles.css
└── views/
    ├── login.ejs
    ├── register.ejs
    ├── dashboard.ejs
    ├── assets.ejs
    ├── asset-form.ejs
    ├── users.ejs
    ├── error.ejs
    ├── partials-header.ejs
    └── partials-message.ejs
```
