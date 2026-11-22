require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set to a random string of at least 32 characters.');
  process.exit(1);
}
if (isProd) app.set('trust proxy', 1);

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  waitForConnections: true, connectionLimit: 10, queueLimit: 0,
  timezone: 'Z', dateStrings: true
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '20kb' }));

const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  createDatabaseTable: true
});
app.use(session({
  name: 'it_inventory_sid', secret: process.env.SESSION_SECRET, store: sessionStore,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.message = req.session.message || null;
  delete req.session.message;
  next();
});

function flash(req, type, text) { req.session.message = { type, text }; }
function requireAuth(req, res, next) {
  if (!req.session.user) { flash(req, 'warning', 'Please log in to continue.'); return res.redirect('/login'); }
  next();
}
function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) return res.status(403).render('error', { title: 'Access denied', message: 'You do not have permission to access this page.' });
    next();
  };
}
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: 'Too many attempts. Please try again after 15 minutes.' });
const clean = (v, max = 120) => String(v || '').trim().slice(0, max);
const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

app.get('/', (req, res) => res.redirect(req.session.user ? '/dashboard' : '/login'));
app.get('/register', (req, res) => req.session.user ? res.redirect('/dashboard') : res.render('register', { title: 'Create account' }));
app.post('/register', authLimiter, async (req, res, next) => {
  try {
    const name = clean(req.body.name, 100), email = clean(req.body.email, 190).toLowerCase();
    const mobile = clean(req.body.mobile, 20), password = String(req.body.password || ''), confirm = String(req.body.confirmPassword || '');
    if (name.length < 2 || !validEmail(email) || password.length < 10 || password.length > 72 || password !== confirm) {
      flash(req, 'danger', 'Check your details. Password must be at least 10 characters and both passwords must match.'); return res.redirect('/register');
    }
    const allowed = (process.env.ALLOWED_EMAIL_DOMAINS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(email.split('@')[1])) { flash(req, 'danger', 'Registration is not allowed for this email domain.'); return res.redirect('/register'); }
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) { flash(req, 'danger', 'An account with this email already exists.'); return res.redirect('/register'); }
    const hash = await bcrypt.hash(password, 12);
    await pool.execute('INSERT INTO users (name,email,mobile,password_hash,role) VALUES (?,?,?,?,\'user\')', [name,email,mobile || null,hash]);
    flash(req, 'success', 'Registration successful. Please log in.'); res.redirect('/login');
  } catch (e) { next(e); }
});
app.get('/login', (req, res) => req.session.user ? res.redirect('/dashboard') : res.render('login', { title: 'Login' }));
app.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = clean(req.body.email, 190).toLowerCase(), password = String(req.body.password || '');
    const [rows] = await pool.execute('SELECT id,name,email,password_hash,role,is_active FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
      flash(req, 'danger', 'Invalid email or password, or account is inactive.'); return res.redirect('/login');
    }
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
      req.session.save(err2 => { if (err2) return next(err2); res.redirect('/dashboard'); });
    });
  } catch (e) { next(e); }
});
app.post('/logout', requireAuth, (req, res, next) => req.session.destroy(err => { if (err) return next(err); res.clearCookie('it_inventory_sid'); res.redirect('/login'); }));

app.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    const [[totals]] = await pool.query(`SELECT COUNT(*) total, SUM(status='available') available, SUM(status='assigned') assigned, SUM(status='repair') repair, SUM(status='retired') retired FROM assets`);
    const [recent] = await pool.query(`SELECT a.*, u.name assigned_name FROM assets a LEFT JOIN users u ON a.assigned_to=u.id ORDER BY a.created_at DESC LIMIT 8`);
    const [locations] = await pool.query('SELECT location, COUNT(*) total FROM assets GROUP BY location ORDER BY total DESC LIMIT 6');
    res.render('dashboard', { title: 'Dashboard', totals, recent, locations });
  } catch (e) { next(e); }
});
app.get('/assets', requireAuth, async (req, res, next) => {
  try {
    const search = clean(req.query.search, 100);
    const [assets] = await pool.execute(`SELECT a.*,u.name assigned_name FROM assets a LEFT JOIN users u ON a.assigned_to=u.id WHERE a.asset_tag LIKE ? OR a.asset_type LIKE ? OR a.location LIKE ? OR COALESCE(a.serial_number,'') LIKE ? ORDER BY a.created_at DESC LIMIT 300`, [`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`]);
    res.render('assets', { title: 'Assets', assets, search });
  } catch (e) { next(e); }
});
app.get('/assets/new', requireAuth, allowRoles('admin','engineer'), async (req,res,next) => {
  try { const [users] = await pool.query("SELECT id,name FROM users WHERE role IN ('engineer','admin') AND is_active=1 ORDER BY name"); res.render('asset-form',{title:'Add asset',asset:{},users,editing:false}); } catch(e){next(e);}
});
app.post('/assets', requireAuth, allowRoles('admin','engineer'), async (req,res,next) => {
  try {
    const a = assetInput(req.body);
    if (!a.asset_tag || !a.asset_type || !a.location) { flash(req,'danger','Asset tag, type and location are required.'); return res.redirect('/assets/new'); }
    await pool.execute(`INSERT INTO assets (asset_tag,asset_type,brand,model,serial_number,location,department,status,assigned_to,purchase_date,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [...a.values,req.session.user.id]);
    flash(req,'success','Asset added successfully.'); res.redirect('/assets');
  } catch(e){ if(e.code==='ER_DUP_ENTRY'){flash(req,'danger','That asset tag already exists.');return res.redirect('/assets/new');} next(e); }
});
function assetInput(b) {
  const status = ['available','assigned','repair','retired'].includes(b.status) ? b.status : 'available';
  const assigned = b.assigned_to ? Number(b.assigned_to) : null;
  return { asset_tag:clean(b.asset_tag,60), values:[clean(b.asset_tag,60),clean(b.asset_type,80),clean(b.brand,80)||null,clean(b.model,100)||null,clean(b.serial_number,120)||null,clean(b.location,120),clean(b.department,100)||null,status,Number.isInteger(assigned)&&assigned>0?assigned:null,b.purchase_date||null,clean(b.notes,2000)||null] };
}
app.get('/assets/:id/edit', requireAuth, allowRoles('admin','engineer'), async(req,res,next)=>{
  try { const [[asset]] = await pool.execute('SELECT * FROM assets WHERE id=?',[req.params.id]); if(!asset)return res.status(404).render('error',{title:'Not found',message:'Asset not found.'}); const [users]=await pool.query("SELECT id,name FROM users WHERE role IN ('engineer','admin') AND is_active=1 ORDER BY name"); res.render('asset-form',{title:'Edit asset',asset,users,editing:true}); }catch(e){next(e);}
});
app.post('/assets/:id/update', requireAuth, allowRoles('admin','engineer'), async(req,res,next)=>{
  try { const a=assetInput(req.body); if(!a.asset_tag||!a.asset_type||!a.location){flash(req,'danger','Asset tag, type and location are required.');return res.redirect(`/assets/${req.params.id}/edit`);} await pool.execute(`UPDATE assets SET asset_tag=?,asset_type=?,brand=?,model=?,serial_number=?,location=?,department=?,status=?,assigned_to=?,purchase_date=?,notes=? WHERE id=?`,[...a.values,req.params.id]); flash(req,'success','Asset updated successfully.');res.redirect('/assets'); }catch(e){if(e.code==='ER_DUP_ENTRY'){flash(req,'danger','That asset tag already exists.');return res.redirect(`/assets/${req.params.id}/edit`);}next(e);}
});
app.post('/assets/:id/delete', requireAuth, allowRoles('admin'), async(req,res,next)=>{try{await pool.execute('DELETE FROM assets WHERE id=?',[req.params.id]);flash(req,'success','Asset deleted.');res.redirect('/assets');}catch(e){next(e);}});

app.get('/users', requireAuth, allowRoles('admin'), async(req,res,next)=>{try{const [users]=await pool.query('SELECT id,name,email,mobile,role,is_active,created_at FROM users ORDER BY created_at DESC');res.render('users',{title:'User management',users});}catch(e){next(e);}});
app.post('/users/:id/update', requireAuth, allowRoles('admin'), async(req,res,next)=>{try{const id=Number(req.params.id),role=['admin','engineer','user'].includes(req.body.role)?req.body.role:'user',active=req.body.is_active==='1'?1:0;if(id===req.session.user.id && (!active||role!=='admin')){flash(req,'danger','You cannot deactivate or demote your own admin account.');return res.redirect('/users');}await pool.execute('UPDATE users SET role=?,is_active=? WHERE id=?',[role,active,id]);flash(req,'success','User updated.');res.redirect('/users');}catch(e){next(e);}});
app.get('/health', async(req,res)=>{try{await pool.query('SELECT 1');res.json({status:'ok',database:'connected'});}catch(e){res.status(503).json({status:'error',database:'unavailable'});}});
app.use((req,res)=>res.status(404).render('error',{title:'Page not found',message:'The page you requested could not be found.'}));
app.use((err,req,res,next)=>{console.error(err);if(res.headersSent)return next(err);res.status(500).render('error',{title:'Server error',message:isProd?'Something went wrong. Please try again.':err.message});});
const port=Number(process.env.PORT||3000);
(async()=>{try{await pool.query('SELECT 1');app.listen(port,()=>console.log(`IT Inventory running on port ${port}`));}catch(e){console.error('Database connection failed:',e.message);process.exit(1);}})();
