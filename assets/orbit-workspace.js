'use strict';

const cloudDialog = $('cloud-dialog');
let cloudIntent = 'list';
let challenge = '';
let listOffset = 0;
let busy = false;

function selectView(preview) {
  document.body.classList.toggle('previewing', preview);
  $('edit-view').setAttribute('aria-pressed', String(!preview));
  $('preview-view').setAttribute('aria-pressed', String(preview));
}
$('edit-view').onclick = () => selectView(false);
$('preview-view').onclick = () => selectView(true);
$('new').addEventListener('click', () => selectView(false));
$('restore-button').onclick = () => $('restore').click();

async function requestCloud(path, method='GET', body) {
  const response = await fetch('/api/orbit/' + path, {
    method, credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(22000),
    headers: body ? {'Content-Type':'application/json'} : {}, body:body ? JSON.stringify(body) : undefined
  });
  const result = await response.json();
  if (!response.ok) {
    const err = new Error(result.error || 'Online billing is unavailable.');
    err.status = response.status;
    throw err;
  }
  return result;
}

function showLogin() {
  $('history-panel').hidden = true;
  $('signin-panel').hidden = false;
  $('verify-form').hidden = !challenge;
  $('cloud-title').textContent = 'Sign in to Orbit Global';
}

async function runCloud(action) {
  if (busy) return;
  busy = true;
  cloudDialog.setAttribute('aria-busy','true');
  const controls = [...cloudDialog.querySelectorAll('button,input')];
  controls.forEach(control => control.disabled = true);
  try {
    await action();
  } catch (err) {
    if (err.status === 401) showLogin();
    $('cloud-message').textContent = err.status ? err.message :
      'Could not connect. Your draft stays on this device. Check your connection and try again.';
  } finally {
    busy = false;
    cloudDialog.removeAttribute('aria-busy');
    controls.forEach(control => control.disabled = false);
  }
}

async function loadBills(append=false) {
  if (!append) { listOffset = 0; $('bill-list').replaceChildren(); }
  $('cloud-title').textContent = 'Saved bills';
  $('signin-panel').hidden = true;
  $('history-panel').hidden = false;
  $('more-bills').hidden = true;
  $('cloud-message').textContent = 'Loading bills…';
  const result = await requestCloud('documents?offset=' + listOffset);
  for (const bill of result.documents) {
    const button = document.createElement('button');
    button.className = 'bill-entry';
    const title = document.createElement('strong'), detail = document.createElement('small');
    title.textContent = bill.number + ' · ' + (bill.buyer || 'Unnamed buyer');
    detail.textContent = bill.mode + ' · ' + bill.date;
    button.append(title, detail);
    button.onclick = () => runCloud(async () => {
      if ((online.dirty || (!online.id && (data.buyer.name || data.items.some(x=>x.description)))) &&
          !confirm('Open this saved bill and replace the draft on this device? Download a backup first to keep your current edits.')) return;
      const saved = await requestCloud('documents/' + bill.id);
      data = normalize(saved.document);
      online = {id:saved.id, revision:saved.revision, dirty:false};
      setup(); persist(); selectView(false); cloudDialog.close();
      window.scrollTo(0,0);
    });
    $('bill-list').append(button);
  }
  listOffset += result.documents.length;
  $('more-bills').hidden = !result.more;
  $('cloud-message').textContent = listOffset ? '' : 'No saved bills yet. Use Save online in the editor to add your first bill.';
}

async function finishIntent() {
  if (cloudIntent !== 'save') return loadBills();
  if (!online.id) online.id = crypto.randomUUID();
  persist();
  $('cloud-message').textContent = 'Saving bill…';
  const saved = await requestCloud('documents/' + online.id,'PUT',{document:data, revision:online.revision});
  online = {id:saved.id, revision:saved.revision, dirty:false};
  persist();
  cloudDialog.close();
}

function openCloud(intent) {
  if (busy) return;
  cloudIntent = intent;
  $('cloud-title').textContent = intent === 'save' ? 'Save online' : 'Saved bills';
  $('cloud-message').textContent = 'Connecting…';
  $('signin-panel').hidden = true; $('history-panel').hidden = true;
  if (!cloudDialog.open) cloudDialog.showModal();
  runCloud(async () => {
    const session = await requestCloud('session');
    if (session.signedIn) return finishIntent();
    $('cloud-message').textContent = '';
    showLogin();
  });
}

cloudDialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
$('close-cloud').onclick = () => cloudDialog.close();
$('save-online').onclick = () => openCloud('save');
$('saved-bills').onclick = () => openCloud('list');
$('send-code').onclick = () => runCloud(async () => {
  const result = await requestCloud('code','POST',{});
  challenge = result.challenge;
  $('verify-form').hidden = false;
  $('login-code').value = '';
  $('send-code').textContent = 'Send another code';
  $('cloud-message').textContent = 'Code sent. It expires in 10 minutes.';
});
$('verify-form').onsubmit = event => {
  event.preventDefault();
  runCloud(async () => {
    await requestCloud('verify','POST',{challenge,code:$('login-code').value.trim()});
    challenge = ''; $('verify-form').hidden = true; $('login-code').value = '';
    $('signin-panel').hidden = true;
    await finishIntent();
  });
};
$('refresh-history').onclick = () => runCloud(() => loadBills());
$('more-bills').onclick = () => runCloud(() => loadBills(true));
$('logout').onclick = () => runCloud(async () => {
  await requestCloud('logout','POST',{});
  $('bill-list').replaceChildren();
  showLogin(); $('cloud-message').textContent = 'Signed out. Your current draft is still on this device.';
});
