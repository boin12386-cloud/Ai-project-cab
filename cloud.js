(() => {
  'use strict';
  const cfgPromise = fetch('/api/config').then(r => r.ok ? r.json() : {}).catch(() => ({}));
  let client = null, currentUser = null, syncTimer = null, lastSyncAt = 0, aiConfigured = false;
  const AI_TOOLS = new Set(['caption','bio','username','hashtags','prompt','reel','ideas','rewrite','polish','thumbnail','carousel','hooks','brief','business']);
  const el = (s, root=document) => root.querySelector(s);
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function notify(message, error=false) {
    if (typeof window.toast === 'function') window.toast(message, error ? 'error' : 'success');
    else {
      const region = el('#toastRegion');
      if (!region) { console[error?'error':'info'](message); return; }
      const node = document.createElement('div'); node.className = 'toast' + (error?' error':'');
      node.textContent = message; region.appendChild(node); setTimeout(()=>node.remove(),3200);
    }
  }
  async function init() {
    const cfg = await cfgPromise;
    aiConfigured = Boolean(cfg.aiConfigured);
    if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase?.createClient) {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      const { data } = await client.auth.getSession();
      currentUser = data?.session?.user || null;
      client.auth.onAuthStateChange(async (_event, session) => {
        currentUser = session?.user || null;
        window.dispatchEvent(new CustomEvent('boin:auth-changed', {detail:{user:currentUser}}));
        if (currentUser) await loadRemoteState();
      });
      if (currentUser) await loadRemoteState();
    }
    const status = el('#aiStatusLabel');
    if (status) {
      status.innerHTML = cfg.aiConfigured
        ? '<span class="status-dot"></span> Real AI ready · server connected'
        : '<span class="status-dot"></span> Demo mode · add server AI credentials to enable real AI';
    }
    window.dispatchEvent(new CustomEvent('boin:auth-changed', {detail:{user:currentUser}}));
  }
  function aiEnabledFor(id) { return aiConfigured && AI_TOOLS.has(id); }
  async function generateAI(tool, inputs) {
    const response = await fetch('/api/ai', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({tool, inputs})
    });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error || 'AI request failed. Check server configuration and try again.');
    if (!data.output) throw new Error('The AI provider returned an empty response.');
    return data.output;
  }
  function markDemoOutput() {
    const status = el('#aiStatusLabel');
    if (status && !status.textContent.includes('Real AI ready')) {
      status.title = 'This output was generated locally using demo templates, not a real AI model.';
    }
  }
  async function loadRemoteState() {
    if (!client || !currentUser) return;
    try {
      const { data, error } = await client.from('user_workspaces').select('state').eq('user_id', currentUser.id).maybeSingle();
      if (error) throw error;
      if (data?.state && typeof data.state === 'object') {
        // Load cloud state before the app initializes its in-memory workspace.
        localStorage.setItem('boin.workspace.v1', JSON.stringify(data.state));
        const reloadKey = `boin-cloud-loaded:${currentUser.id}`;
        if (sessionStorage.getItem(reloadKey) !== '1') {
          sessionStorage.setItem(reloadKey, '1');
          location.reload();
        }
      }
    } catch (e) {
      console.warn('BOIN cloud restore skipped:', e.message);
    }
  }
  function queueStateSync(state) {
    if (!client || !currentUser) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        const { error } = await client.from('user_workspaces').upsert({
          user_id: currentUser.id, state, updated_at: new Date().toISOString()
        }, {onConflict:'user_id'});
        if (error) throw error;
        lastSyncAt = Date.now();
      } catch (e) {
        console.warn('BOIN cloud sync failed:', e.message);
      }
    }, 900);
  }
  function openAccount() {
    const modal = el('#genericModal'), title = el('#genericTitle'), body = el('#genericBody');
    if (!modal || !title || !body) return;
    title.textContent = currentUser ? 'Your BOIN account' : 'Sign in to BOIN';
    const cfgReady = !!client;
    if (!cfgReady) {
      body.innerHTML = `<div class="empty-state"><div class="empty-icon">☁</div><strong>Cloud account not configured</strong><p>Guest mode works now. To enable accounts and cross-device sync, configure Supabase URL and publishable key in your hosting environment, then run the SQL setup file included with BOIN.</p><p><a href="https://supabase.com" target="_blank" rel="noreferrer">Open Supabase ↗</a></p></div>`;
    } else if (currentUser) {
      body.innerHTML = `<div class="empty-state"><div class="empty-icon">☁</div><strong>Signed in</strong><p>${escape(currentUser.email || '')}</p><p>Your workspace syncs to your account when you make changes.</p><div class="form-actions"><button class="btn btn-secondary" id="exportAccountData">Export my data</button><button class="btn btn-primary" id="signOutBoin">Sign out</button></div><button class="text-link" id="deleteAccountInfo">Account deletion information</button></div>`;
      el('#signOutBoin')?.addEventListener('click', async()=>{await client.auth.signOut();currentUser=null;window.dispatchEvent(new CustomEvent('boin:auth-changed',{detail:{user:null}}));modal.classList.remove('open');notify('Signed out.');});
      el('#exportAccountData')?.addEventListener('click',()=>{const raw=localStorage.getItem('boin.workspace.v1')||'{}';const blob=new Blob([raw],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='boin-workspace-export.json';a.click();URL.revokeObjectURL(a.href);});
      el('#deleteAccountInfo')?.addEventListener('click',()=>notify('To delete your account, use the Supabase dashboard or add a verified server-side account deletion endpoint before launch.',true));
    } else {
      body.innerHTML = `<p class="subtle">Use your email to create an account or sign in. Email confirmation settings depend on your Supabase project.</p>
        <form id="boinAuthForm" class="tool-form">
          <div class="field"><label for="boinEmail">Email</label><input class="form-control" id="boinEmail" name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com"></div>
          <div class="field"><label for="boinPassword">Password</label><input class="form-control" id="boinPassword" name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required placeholder="At least 8 characters"></div>
          <div class="form-actions"><button class="btn btn-primary" type="submit" name="mode" value="signin">Sign in</button><button class="btn btn-secondary" type="submit" name="mode" value="signup">Create account</button></div>
          <button type="button" class="text-link" id="boinForgotPassword">Forgot password?</button>
          <p class="subtle" id="boinAuthMessage" aria-live="polite"></p>
        </form>`;
      el('#boinAuthForm')?.addEventListener('submit', async e=>{
        e.preventDefault(); const form=e.currentTarget; const fd=new FormData(form);
        const email=String(fd.get('email')||'').trim(), password=String(fd.get('password')||'');
        const submitter=e.submitter; const mode=submitter?.value || 'signin';
        const msg=el('#boinAuthMessage'); if(msg)msg.textContent='Please wait…';
        try {
          let result;
          if(mode==='signup') result=await client.auth.signUp({email,password});
          else result=await client.auth.signInWithPassword({email,password});
          if(result.error) throw result.error;
          if(mode==='signup' && !result.data.session) { if(msg)msg.textContent='Account created. Check your email to confirm it, then sign in.'; return; }
          currentUser=result.data.user||result.data.session?.user||null;
          window.dispatchEvent(new CustomEvent('boin:auth-changed',{detail:{user:currentUser}}));
          if(currentUser) await loadRemoteState();
          modal.classList.remove('open'); notify(mode==='signup'?'Account created.':'Signed in.');
        } catch(err) { if(msg)msg.textContent=err.message||'Authentication failed.'; }
      });
      el('#boinForgotPassword')?.addEventListener('click', async()=>{
        const email=el('#boinEmail')?.value.trim();
        if(!email){notify('Enter your email address first.',true);return;}
        const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin});
        if(error)notify(error.message,true);else notify('If the account exists, a password reset email has been sent.');
      });
    }
    modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  }
  window.BOIN_CLOUD = { aiEnabledFor, generateAI, markDemoOutput, queueStateSync, openAccount, getUser:()=>currentUser, getLastSyncAt:()=>lastSyncAt };
  document.addEventListener('DOMContentLoaded', init);
})();
