// CSS and JS string templates inlined into the generated HTML report.
// The viewer reads each `<div class="jv" data-json="...">` block and renders
// UI / Tree / JSON tabs. Zero external dependencies — the report file is fully
// self-contained and works offline.
//
// Safety: all values that enter the DOM go through escapeHtml(); the JSON
// payload is delivered via a data attribute and explicitly parsed. Because the
// JSON content originates from the user's own API responses captured in their
// session, there is no untrusted network input path here.

export const JSON_VIEWER_CSS = `
.jv { border: 1px solid #d1d9e0; border-radius: 12px; background: #f7f7f8; padding: 14px 16px; margin: 12px 0; font-family: -apple-system, "Segoe UI", "Pretendard", sans-serif; color: #1f2328; font-size: 13px; }
.jv-tabs { display: flex; gap: 20px; border-bottom: 1px solid #d1d9e0; padding-bottom: 8px; margin-bottom: 12px; }
.jv-tab { font-weight: 600; color: #6e7781; cursor: pointer; padding: 4px 0; user-select: none; font-size: 12px; letter-spacing: 0.02em; }
.jv-tab.active { color: #d97706; border-bottom: 2px solid #d97706; padding-bottom: 2px; }
.jv-tab.disabled { color: #d1d9e0; cursor: not-allowed; }
.jv-pane { display: none; }
.jv-pane.active { display: block; }
.jv-note { padding: 8px 12px; background: #fef3c7; border-left: 3px solid #d97706; border-radius: 4px; color: #78350f; font-size: 12px; margin-bottom: 8px; }

.jv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.jv-card { border: 1px solid; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; min-width: 0; overflow: hidden; }
.jv-card-hd { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.jv-icon { font-weight: 700; font-size: 11px; flex-shrink: 0; min-width: 14px; }
.jv-key { font-weight: 600; font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.jv-path { color: #8b949e; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 90px; font-family: "JetBrains Mono", Consolas, monospace; }
.jv-val { font-size: 13px; word-break: break-all; line-height: 1.4; }
.jv-card.t-str { background: #ecfdf5; border-color: #a7f3d0; }
.jv-card.t-str .jv-icon, .jv-card.t-str .jv-val { color: #047857; }
.jv-card.t-str .jv-key { color: #064e3b; }
.jv-card.t-num { background: #eff6ff; border-color: #bfdbfe; }
.jv-card.t-num .jv-icon, .jv-card.t-num .jv-val { color: #1d4ed8; }
.jv-card.t-num .jv-key { color: #1e3a8a; }
.jv-card.t-bool { background: #faf5ff; border-color: #e9d5ff; }
.jv-card.t-bool .jv-icon, .jv-card.t-bool .jv-val { color: #7e22ce; }
.jv-card.t-bool .jv-key { color: #581c87; }
.jv-card.t-null { background: #f3f4f6; border-color: #d1d5db; }
.jv-card.t-null .jv-icon, .jv-card.t-null .jv-val { color: #6b7280; font-style: italic; }
.jv-card.t-null .jv-key { color: #374151; }
.jv-group { grid-column: 1 / -1; border: 1px solid #d1d9e0; border-radius: 8px; background: #fff; overflow: hidden; }
.jv-group-hd { display: flex; align-items: center; gap: 8px; padding: 10px 14px; cursor: pointer; user-select: none; }
.jv-group-hd:hover { background: #f9fafb; }
.jv-group-hd .jv-icon { color: #6e7781; }
.jv-group-name { font-weight: 600; color: #1f2328; }
.jv-count { color: #8b949e; font-size: 12px; }
.jv-group-body { padding: 0 14px 12px; display: none; }
.jv-group.open > .jv-group-body { display: block; }
.jv-group.open > .jv-group-hd .jv-toggle::before { content: '▼ '; }
.jv-group:not(.open) > .jv-group-hd .jv-toggle::before { content: '▶ '; }

.jv-tree { font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace; font-size: 12px; line-height: 1.7; color: #1f2328; max-height: 600px; overflow: auto; padding: 8px 12px; background: #fff; border: 1px solid #d1d9e0; border-radius: 6px; }
.jv-tree .row { display: flex; gap: 4px; align-items: baseline; }
.jv-tree .ind { color: transparent; white-space: pre; }
.jv-tree .tg { color: #6e7781; cursor: pointer; user-select: none; min-width: 12px; display: inline-block; }
.jv-tree .tg-empty { min-width: 12px; display: inline-block; }
.jv-tree .k { color: #b91c1c; }
.jv-tree .s { color: #047857; }
.jv-tree .n { color: #1d4ed8; }
.jv-tree .b { color: #7e22ce; }
.jv-tree .nl { color: #6b7280; font-style: italic; }
.jv-tree .br { color: #6e7781; }
.jv-tree .children { display: block; }
.jv-tree .node.collapsed > .children { display: none; }
.jv-tree .node.collapsed > .row .tg::before { content: '▶'; }
.jv-tree .node:not(.collapsed) > .row .tg::before { content: '▼'; }

.jv-json { font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace; font-size: 12px; line-height: 1.55; color: #1f2328; white-space: pre; overflow: auto; padding: 10px 14px; background: #fff; border: 1px solid #d1d9e0; border-radius: 6px; max-height: 600px; margin: 0; }
.jv-json .k { color: #b91c1c; }
.jv-json .s { color: #047857; }
.jv-json .n { color: #1d4ed8; }
.jv-json .b { color: #7e22ce; }
.jv-json .nl { color: #6b7280; font-style: italic; }
`

// All html string assembly funnels through escapeHtml; values are then placed
// into the document via insertAdjacentHTML on freshly created elements.
export const JSON_VIEWER_JS = `
(function(){
  var RENDER_LIMIT = 100 * 1024;
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function humanKey(k) {
    if (k === null || k === undefined || k === '') return k || '';
    var s = String(k).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }
  function replaceContent(target, html) {
    while (target.firstChild) target.removeChild(target.firstChild);
    target.insertAdjacentHTML('beforeend', html);
  }
  function renderUiNode(key, value) {
    var t = typeOf(value);
    var labelKey = escapeHtml(humanKey(String(key)));
    var pathKey = escapeHtml(String(key));
    if (t === 'string') {
      return '<div class="jv-card t-str"><div class="jv-card-hd"><span class="jv-icon">T</span><span class="jv-key">'+labelKey+'</span><span class="jv-path">'+pathKey+'</span></div><div class="jv-val">'+escapeHtml(value)+'</div></div>';
    }
    if (t === 'number') {
      return '<div class="jv-card t-num"><div class="jv-card-hd"><span class="jv-icon">#</span><span class="jv-key">'+labelKey+'</span><span class="jv-path">'+pathKey+'</span></div><div class="jv-val">'+escapeHtml(String(value))+'</div></div>';
    }
    if (t === 'boolean') {
      return '<div class="jv-card t-bool"><div class="jv-card-hd"><span class="jv-icon">?</span><span class="jv-key">'+labelKey+'</span><span class="jv-path">'+pathKey+'</span></div><div class="jv-val">'+(value ? 'true' : 'false')+'</div></div>';
    }
    if (t === 'null') {
      return '<div class="jv-card t-null"><div class="jv-card-hd"><span class="jv-icon">∅</span><span class="jv-key">'+labelKey+'</span><span class="jv-path">'+pathKey+'</span></div><div class="jv-val">null</div></div>';
    }
    var isArr = (t === 'array');
    var count = isArr ? value.length : Object.keys(value).length;
    var inner;
    if (isArr) {
      var parts = [];
      for (var i = 0; i < value.length; i++) parts.push(renderUiNode(i, value[i]));
      inner = parts.join('');
    } else {
      var ks = Object.keys(value);
      var parts2 = [];
      for (var j = 0; j < ks.length; j++) parts2.push(renderUiNode(ks[j], value[ks[j]]));
      inner = parts2.join('');
    }
    var iconStr = isArr ? '[]' : '{}';
    return '<div class="jv-group"><div class="jv-group-hd" data-toggle="group"><span class="jv-toggle"></span><span class="jv-icon">'+iconStr+'</span><span class="jv-group-name">'+labelKey+'</span><span class="jv-count">('+count+')</span></div><div class="jv-group-body"><div class="jv-grid">'+inner+'</div></div></div>';
  }
  function renderUi(data) {
    if (data === null || data === undefined) return '<div class="jv-note">데이터 없음</div>';
    var t = typeOf(data);
    if (t === 'object') {
      var ks = Object.keys(data);
      var parts = [];
      for (var i = 0; i < ks.length; i++) parts.push(renderUiNode(ks[i], data[ks[i]]));
      return '<div class="jv-grid">' + parts.join('') + '</div>';
    }
    if (t === 'array') {
      var parts2 = [];
      for (var j = 0; j < data.length; j++) parts2.push(renderUiNode(j, data[j]));
      return '<div class="jv-grid">' + parts2.join('') + '</div>';
    }
    return '<div class="jv-grid">' + renderUiNode('value', data) + '</div>';
  }
  function renderTreeNode(value, key, depth) {
    var t = typeOf(value);
    var ind = new Array(depth + 1).join('  ');
    var keyPart = (key !== null && key !== undefined) ? '<span class="k">"'+escapeHtml(String(key))+'"</span>: ' : '';
    if (t === 'string') return '<div class="row"><span class="ind">'+ind+'</span><span class="tg-empty"></span>'+keyPart+'<span class="s">"'+escapeHtml(value)+'"</span></div>';
    if (t === 'number') return '<div class="row"><span class="ind">'+ind+'</span><span class="tg-empty"></span>'+keyPart+'<span class="n">'+escapeHtml(String(value))+'</span></div>';
    if (t === 'boolean') return '<div class="row"><span class="ind">'+ind+'</span><span class="tg-empty"></span>'+keyPart+'<span class="b">'+(value?'true':'false')+'</span></div>';
    if (t === 'null') return '<div class="row"><span class="ind">'+ind+'</span><span class="tg-empty"></span>'+keyPart+'<span class="nl">null</span></div>';
    var isArr = (t === 'array');
    var open = isArr ? '[' : '{';
    var close = isArr ? ']' : '}';
    var count = isArr ? value.length : Object.keys(value).length;
    if (count === 0) return '<div class="row"><span class="ind">'+ind+'</span><span class="tg-empty"></span>'+keyPart+'<span class="br">'+open+close+'</span></div>';
    var childRows;
    if (isArr) {
      var parts = [];
      for (var i = 0; i < value.length; i++) parts.push(renderTreeNode(value[i], null, depth+1));
      childRows = parts.join('');
    } else {
      var ks = Object.keys(value);
      var parts2 = [];
      for (var j = 0; j < ks.length; j++) parts2.push(renderTreeNode(value[ks[j]], ks[j], depth+1));
      childRows = parts2.join('');
    }
    var label = isArr ? ('Array(' + count + ')') : ('Object(' + count + ')');
    return '<div class="node"><div class="row"><span class="ind">'+ind+'</span><span class="tg" data-toggle="node"></span>'+keyPart+'<span class="br">'+open+'</span> <span class="b">'+label+'</span></div><div class="children">'+childRows+'</div></div>';
  }
  function renderJson(data) {
    var s;
    try { s = JSON.stringify(data, null, 2); } catch(e) { return '<div class="jv-note">JSON 직렬화 실패</div>'; }
    s = escapeHtml(s);
    s = s.replace(/(&quot;(?:[^&]|&amp;|&#39;)*?&quot;)(\\s*:)/g, '<span class="k">$1</span>$2');
    s = s.replace(/:\\s(&quot;(?:[^&]|&amp;|&#39;)*?&quot;)/g, ': <span class="s">$1</span>');
    s = s.replace(/:\\s(-?\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)/g, ': <span class="n">$1</span>');
    s = s.replace(/:\\s(true|false)\\b/g, ': <span class="b">$1</span>');
    s = s.replace(/:\\s(null)\\b/g, ': <span class="nl">$1</span>');
    return s;
  }
  function init(el) {
    var raw = el.getAttribute('data-json') || 'null';
    var size = raw.length;
    var data;
    try { data = JSON.parse(raw); }
    catch(e) {
      replaceContent(el, '<div class="jv-note">JSON 파싱 실패: '+escapeHtml(String(e.message||e))+'</div><pre class="jv-json">'+escapeHtml(raw.slice(0, 4000))+'</pre>');
      return;
    }
    var tooLarge = size > RENDER_LIMIT;
    var startTab = el.getAttribute('data-default-tab') || 'json';
    if (tooLarge) startTab = 'json';
    var tabs = '<div class="jv-tabs">'
      + '<span class="jv-tab'+(startTab==='json'?' active':'')+'" data-tab="json">JSON</span>'
      + '<span class="jv-tab'+(tooLarge?' disabled':(startTab==='tree'?' active':''))+'" data-tab="tree">Tree</span>'
      + '<span class="jv-tab'+(tooLarge?' disabled':(startTab==='ui'?' active':''))+'" data-tab="ui">UI</span>'
      + '</div>';
    var note = tooLarge ? '<div class="jv-note">JSON 크기 '+(size/1024).toFixed(1)+'KB — 100KB 이상이라 UI/Tree 뷰는 비활성. JSON 뷰만 표시됩니다.</div>' : '';
    var ui = tooLarge ? '' : ('<div class="jv-pane'+(startTab==='ui'?' active':'')+'" data-pane="ui">'+renderUi(data)+'</div>');
    var tree = tooLarge ? '' : ('<div class="jv-pane'+(startTab==='tree'?' active':'')+'" data-pane="tree"><div class="jv-tree">'+renderTreeNode(data, null, 0)+'</div></div>');
    var json = '<div class="jv-pane'+(startTab==='json'?' active':'')+'" data-pane="json"><pre class="jv-json">'+renderJson(data)+'</pre></div>';
    replaceContent(el, tabs + note + ui + tree + json);
    el.addEventListener('click', function(e){
      var target = e.target;
      var tab = target.closest && target.closest('.jv-tab');
      if (tab && el.contains(tab) && !tab.classList.contains('disabled')) {
        var which = tab.getAttribute('data-tab');
        var allTabs = el.querySelectorAll('.jv-tab');
        for (var i=0;i<allTabs.length;i++) allTabs[i].classList.remove('active');
        tab.classList.add('active');
        var allPanes = el.querySelectorAll('.jv-pane');
        for (var j=0;j<allPanes.length;j++) {
          if (allPanes[j].getAttribute('data-pane') === which) allPanes[j].classList.add('active');
          else allPanes[j].classList.remove('active');
        }
        return;
      }
      var groupHd = target.closest && target.closest('[data-toggle="group"]');
      if (groupHd && el.contains(groupHd)) { groupHd.parentNode.classList.toggle('open'); return; }
      var treeTg = target.closest && target.closest('[data-toggle="node"]');
      if (treeTg && el.contains(treeTg)) { treeTg.parentNode.parentNode.classList.toggle('collapsed'); return; }
    });
  }
  var all = document.querySelectorAll('.jv');
  for (var i = 0; i < all.length; i++) init(all[i]);
})();
`

export function jsonViewerBlock(jsonValue: unknown, defaultTab: 'ui' | 'tree' | 'json' = 'json'): string {
  let raw: string
  try { raw = JSON.stringify(jsonValue ?? null) } catch { raw = 'null' }
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<div class="jv" data-json="${escaped}" data-default-tab="${defaultTab}"></div>`
}
