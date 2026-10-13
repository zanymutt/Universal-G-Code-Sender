// Stands in for the Dashboard's plugin bridge so the plugin can be exercised in a plain browser.
const params = new URLSearchParams(location.search);
window.addEventListener('message', async event => {
  if (event.source !== document.querySelector('iframe').contentWindow || event.data?.type !== 'fluid-request') return;
  const { id, method, params: p } = event.data;
  const reply = result => event.source.postMessage({ type: 'fluid-response', id, result }, '*');
  if (method === 'getSettings') reply(JSON.parse(localStorage.getItem('nestTestSettings') || '{}'));
  else if (method === 'saveSettings') { localStorage.setItem('nestTestSettings', JSON.stringify(p.data)); reply(p.data); }
  else if (method === 'getGcode') reply(params.has('empty') ? '' : await (await fetch('sample.gcode')).text());
  else if (method === 'getFileStatus') reply({ fileName: 'C:\\jobs\\sample.gcode' });
  else if (method === 'saveGcodeAs') {
    document.getElementById('status').textContent = 'Save As bridge received ' + p.content.split('\n').length + ' lines. No machine commands or disk writes.';
    reply({ path: 'simulated.gcode' });
  } else event.source.postMessage({ type: 'fluid-response', id, error: 'Not simulated: ' + method }, '*');
});
