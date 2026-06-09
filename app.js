(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HMI_NS = 'http://svg.siemens.com/hmi/';
  const HMI_BIND_NS = 'http://svg.siemens.com/hmi/bind/';
  const HMI_DOCTYPE = '<!DOCTYPE svg PUBLIC "-//SIEMENS//DTD SVG 1.0 TIA-HMI//EN" "https://tia.siemens.com/graphics/svg/1.0/dtd/svg-hmi.dtd">';
  const COLOR_ATTRIBUTES = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'];
  const CURRENT_COLOR_FALLBACK = '#000000';
  const ANIMATION_TAGS = ['animate', 'animateTransform', 'animateMotion', 'set'];
  const PROPERTY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const SVG_MIME_TYPE = 'image/svg+xml;charset=utf-8';
  const NAMED_COLORS = {
    black: '#000000', silver: '#C0C0C0', gray: '#808080', white: '#FFFFFF', maroon: '#800000', red: '#FF0000',
    purple: '#800080', fuchsia: '#FF00FF', green: '#008000', lime: '#00FF00', olive: '#808000', yellow: '#FFFF00',
    navy: '#000080', blue: '#0000FF', teal: '#008080', aqua: '#00FFFF', orange: '#FFA500', aliceblue: '#F0F8FF',
    brown: '#A52A2A', cyan: '#00FFFF', magenta: '#FF00FF', grey: '#808080', transparent: 'transparent'
  };

  const state = {
    fileName: '',
    sourceText: '',
    sanitizedSvgText: '',
    colors: new Map(),
    dynamicConfig: new Map(),
    testValues: new Map(),
    warnings: [],
    generatedCode: ''
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    fileInput: $('fileInput'), dropZone: $('dropZone'), fileMeta: $('fileMeta'), status: $('statusMessage'), warnings: $('warnings'),
    colorList: $('colorList'), propertyControls: $('propertyControls'), originalPreview: $('originalPreview'), dynamicPreview: $('dynamicPreview'),
    codeOutput: $('codeOutput'), downloadButton: $('downloadButton'), copyButton: $('copyButton'), downloadCleanButton: $('downloadCleanButton'),
    resetButton: $('resetButton'), validationSummary: $('validationSummary')
  };

  els.fileInput.addEventListener('change', (event) => handleFile(event.target.files?.[0]));
  els.dropZone.addEventListener('dragover', (event) => { event.preventDefault(); els.dropZone.classList.add('dragover'); });
  els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
  els.dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    els.dropZone.classList.remove('dragover');
    handleFile(event.dataTransfer.files?.[0]);
  });
  els.resetButton.addEventListener('click', resetApp);
  els.downloadButton.addEventListener('click', () => downloadText(buildExportFileName(), state.generatedCode, 'image/svg+xml'));
  els.downloadCleanButton.addEventListener('click', () => downloadText(buildCleanFileName(), state.sanitizedSvgText, 'image/svg+xml'));
  els.copyButton.addEventListener('click', copyGeneratedCode);
  els.colorList.addEventListener('input', handleColorListInput);
  els.colorList.addEventListener('change', handleColorListInput);

  function resetApp() {
    revokePreviewUrls();
    state.fileName = '';
    state.sourceText = '';
    state.sanitizedSvgText = '';
    state.colors.clear();
    state.dynamicConfig.clear();
    state.testValues.clear();
    state.warnings = [];
    state.generatedCode = '';
    els.fileInput.value = '';
    els.fileMeta.textContent = '';
    setStatus('Noch keine Datei geladen.');
    els.warnings.className = 'notice-list empty';
    els.warnings.textContent = 'Nach dem Import erscheinen hier Hinweise zu SVG-Features, die für WinCC Unified problematisch sein können.';
    els.colorList.className = 'color-list empty';
    els.colorList.textContent = 'Noch keine Farben erkannt.';
    els.propertyControls.className = 'property-controls empty';
    els.propertyControls.textContent = 'Dynamisierte Properties erscheinen hier als Color-Picker.';
    els.originalPreview.className = 'preview-box empty';
    els.originalPreview.textContent = 'Kein SVG geladen.';
    els.dynamicPreview.className = 'preview-box empty';
    els.dynamicPreview.textContent = 'Noch keine dynamisierte Vorschau.';
    els.codeOutput.value = '';
    els.validationSummary.hidden = true;
    setExportEnabled(false);
  }

  function handleFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.svg') && file.type !== 'image/svg+xml') {
      setStatus('Bitte eine .svg-Datei auswählen.', true);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => parseSvg(String(reader.result || ''), file);
    reader.onerror = () => setStatus('Die Datei konnte nicht gelesen werden.', true);
    reader.readAsText(file);
  }

  function parseSvg(text, file) {
    try {
      revokePreviewUrls();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'image/svg+xml');
      if (doc.querySelector('parsererror') || doc.documentElement.localName.toLowerCase() !== 'svg') {
        throw new Error('Die Datei ist kein gültiges SVG-Dokument.');
      }

      state.fileName = file.name;
      state.sourceText = text;
      state.warnings = inspectSvg(doc);
      const cleanDoc = sanitizeSvgDocument(doc, state.warnings);
      normalizeInlinePaintStyles(cleanDoc);
      ensureSvgNamespaces(cleanDoc.documentElement);
      state.sanitizedSvgText = serializeSvg(cleanDoc);
      state.colors = extractColors(cleanDoc);
      seedDynamicConfig();

      els.fileMeta.textContent = `${file.name} · ${formatBytes(file.size)} · lokal verarbeitet`;
      setStatus(`SVG geladen. ${state.colors.size} dynamisierbare Farbe(n) erkannt.`, false, true);
      renderWarnings();
      renderColorList();
      refreshAll();
      renderPreview(els.originalPreview, state.sanitizedSvgText, 'Bereinigte Originalvorschau');
      els.downloadCleanButton.disabled = false;
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function inspectSvg(doc) {
    const warnings = [];
    addCountWarning(warnings, doc.querySelectorAll('script').length, 'Skripte entfernt', '<script>-Tags werden aus Sicherheitsgründen entfernt.', 'danger');
    addCountWarning(warnings, doc.querySelectorAll('foreignObject').length, 'foreignObject entfernt', '<foreignObject> ist in HMI-Umgebungen problematisch und wird entfernt.', 'danger');
    for (const tag of ANIMATION_TAGS) addCountWarning(warnings, doc.getElementsByTagName(tag).length, 'SVG-Animation entfernt', `<${tag}> wird entfernt, da dynamische Siemens-Bindings über HMI-Properties erfolgen sollen.`, 'warning');
    addCountWarning(warnings, doc.querySelectorAll('style').length, 'Style-Block entfernt', '<style>-Blöcke werden entfernt. Inline-Paint-Styles werden soweit möglich in Attribute überführt.', 'warning');
    addCountWarning(warnings, doc.querySelectorAll('[style]').length, 'Inline-Styles gefunden', 'Paint-Eigenschaften aus style="..." werden ausgewertet; andere Style-Deklarationen bleiben nur nach Bereinigung erhalten.', 'warning');
    addCountWarning(warnings, countCurrentColorPaints(doc), 'currentColor erkannt', `currentColor-Paint-Werte werden über die SVG/CSS-Farbe aufgelöst und ohne explizite color-Angabe als ${CURRENT_COLOR_FALLBACK} dynamisierbar gemacht.`, 'warning');
    if (!doc.documentElement.getAttribute('viewBox')) warnings.push({ title: 'viewBox fehlt', message: 'WinCC Unified profitiert von einem stabilen viewBox. Breite/Höhe bleiben erhalten, aber Skalierung kann eingeschränkt sein.', level: 'warning' });

    let eventHandlers = 0;
    let externalRefs = 0;
    const externalPattern = /(?:https?:)?\/\//i;
    for (const el of doc.querySelectorAll('*')) {
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name)) eventHandlers += 1;
        if (['href', 'xlink:href', 'src'].includes(attr.name) && externalPattern.test(attr.value)) externalRefs += 1;
        if (/url\(\s*['"]?(?:https?:)?\/\//i.test(attr.value)) externalRefs += 1;
      }
    }
    addCountWarning(warnings, eventHandlers, 'Event-Handler entfernt', 'Attribute wie onload, onclick oder onmouseover werden entfernt.', 'danger');
    addCountWarning(warnings, externalRefs, 'Externe Referenzen entfernt', 'Externe URLs in href/src/url(...) werden entfernt, damit die Datei offline und HMI-tauglich bleibt.', 'danger');

    const riskySelectors = ['image', 'use', 'filter', 'mask', 'clipPath', 'pattern'];
    for (const selector of riskySelectors) {
      const count = doc.getElementsByTagName(selector).length;
      if (count) warnings.push({ title: `SVG-Feature <${selector}> gefunden`, message: `${count} Vorkommen bleibt nach Möglichkeit erhalten, kann aber je nach WinCC Unified Runtime Einschränkungen haben.`, level: 'warning' });
    }
    return warnings;
  }

  function sanitizeSvgDocument(doc, warnings) {
    const cleanDoc = doc.cloneNode(true);
    cleanDoc.querySelectorAll(['script', 'foreignObject', 'style', ...ANIMATION_TAGS].join(',')).forEach((el) => el.remove());
    const externalPattern = /(?:https?:)?\/\//i;
    for (const el of cleanDoc.querySelectorAll('*')) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name;
        const value = attr.value;
        if (/^on/i.test(name)) el.removeAttribute(name);
        if ((['href', 'xlink:href', 'src'].includes(name) && externalPattern.test(value)) || /url\(\s*['"]?(?:https?:)?\/\//i.test(value)) {
          el.removeAttribute(name);
        }
        if (name === 'style') el.setAttribute('style', sanitizeStyle(value));
      }
    }
    if (!warnings.length) warnings.push({ title: 'Keine kritischen Inhalte erkannt', message: 'Das SVG enthält keine der explizit geprüften problematischen Elemente.', level: 'success' });
    return cleanDoc;
  }

  function sanitizeStyle(styleText) {
    return parseStyle(styleText)
      .filter(([name, value]) => !/^behavior$/i.test(name) && !/url\(\s*['"]?(?:https?:)?\/\//i.test(value) && !/expression\s*\(/i.test(value))
      .map(([name, value]) => `${name}: ${value}`)
      .join('; ');
  }

  function normalizeInlinePaintStyles(doc) {
    for (const el of doc.querySelectorAll('[style]')) {
      const remaining = [];
      for (const [name, value] of parseStyle(el.getAttribute('style'))) {
        if (COLOR_ATTRIBUTES.includes(name)) {
          el.setAttribute(name, value);
        } else if (value.trim()) {
          remaining.push(`${name}: ${value}`);
        }
      }
      if (remaining.length) el.setAttribute('style', remaining.join('; '));
      else el.removeAttribute('style');
    }
  }

  function extractColors(doc) {
    const colors = new Map();
    for (const el of doc.querySelectorAll('*')) {
      for (const attr of COLOR_ATTRIBUTES) {
        if (!el.hasAttribute(attr)) continue;
        const raw = el.getAttribute(attr).trim();
        const normalized = resolvePaintColor(raw, el);
        if (!normalized || normalized.special) continue;
        if (!colors.has(normalized.hex)) colors.set(normalized.hex, { hex: normalized.hex, count: 0, attributes: new Set(), rawValues: new Set() });
        const entry = colors.get(normalized.hex);
        entry.count += 1;
        entry.attributes.add(attr);
        entry.rawValues.add(raw);
        el.setAttribute(attr, normalized.hex);
      }
    }
    return new Map([...colors.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])));
  }

  function seedDynamicConfig() {
    state.dynamicConfig.clear();
    state.testValues.clear();
    let index = 1;
    for (const [hex] of state.colors) {
      const propertyName = suggestPropertyName(hex, index++);
      state.dynamicConfig.set(hex, { enabled: false, propertyName, defaultColor: hex });
      state.testValues.set(propertyName, hex);
    }
  }

  function renderWarnings() {
    els.warnings.className = 'notice-list';
    els.warnings.innerHTML = state.warnings.map((warning) => `
      <div class="notice ${escapeHtml(warning.level || 'warning')}">
        <span>${warning.level === 'danger' ? '⚠️' : warning.level === 'success' ? '✅' : 'ℹ️'}</span>
        <div><strong>${escapeHtml(warning.title)}</strong><small>${escapeHtml(warning.message)}</small></div>
      </div>`).join('');
  }

  function renderColorList() {
    if (!state.colors.size) {
      els.colorList.className = 'color-list empty';
      els.colorList.textContent = 'Keine dynamisierbaren Farben gefunden. Sonderwerte wie none, transparent, inherit, initial und unset werden bewusst nicht dynamisiert.';
      return;
    }
    els.colorList.className = 'color-list';
    els.colorList.innerHTML = '';
    for (const [hex, entry] of state.colors) {
      const config = state.dynamicConfig.get(hex);
      const row = document.createElement('div');
      row.className = 'color-row';
      row.innerHTML = `
        <span class="swatch" style="background:${hex}"></span>
        <div class="color-main"><strong>${hex}</strong><small>${entry.count} Vorkommen · ${[...entry.attributes].join(', ')}</small></div>
        <label class="toggle"><input type="checkbox" data-action="toggle" data-hex="${hex}"> dynamisieren</label>
        <input class="text-input" data-action="name" data-hex="${hex}" value="${escapeHtml(config.propertyName)}" aria-label="Property-Name für ${hex}">
        <input class="color-input" type="color" data-action="default" data-hex="${hex}" value="${hex}" aria-label="Default-Farbe für ${hex}">
      `;
      row.querySelector('[data-action="toggle"]').checked = config.enabled;
      row.querySelector('[data-action="name"]').disabled = !config.enabled;
      row.querySelector('[data-action="default"]').disabled = !config.enabled;
      els.colorList.appendChild(row);
    }
  }

  function handleColorListInput(event) {
    const target = event.target;
    const hex = target.dataset?.hex;
    if (hex && state.dynamicConfig.has(hex)) {
      const config = state.dynamicConfig.get(hex);
      if (target.dataset.action === 'toggle') config.enabled = target.checked;
      if (target.dataset.action === 'name') config.propertyName = target.value.trim();
      if (target.dataset.action === 'default') config.defaultColor = target.value.toUpperCase();
      state.testValues.set(config.propertyName, config.defaultColor);
      renderColorList();
      refreshAll();
    }
  }

  function refreshAll() {
    const validation = validateConfig();
    renderValidation(validation);
    renderPropertyControls(validation.valid);
    state.generatedCode = validation.valid && state.sanitizedSvgText ? generateSvghmi(validation.configs) : '';
    els.codeOutput.value = state.generatedCode;
    setExportEnabled(Boolean(state.generatedCode));
    const previewSvg = state.sanitizedSvgText ? generatePreviewSvg(validation.configs, validation.valid) : '';
    if (previewSvg) renderPreview(els.dynamicPreview, previewSvg, 'Testvorschau');
  }

  function validateConfig() {
    const errors = [];
    const configs = [];
    const names = new Map();
    for (const [hex, config] of state.dynamicConfig) {
      if (!config.enabled) continue;
      const name = config.propertyName.trim();
      if (!PROPERTY_NAME_PATTERN.test(name)) errors.push(`Property für ${hex}: nur Buchstaben, Zahlen und Unterstrich; Beginn mit Buchstabe oder Unterstrich.`);
      if (names.has(name)) errors.push(`Property-Name "${name}" ist doppelt vergeben (${names.get(name)} und ${hex}).`);
      names.set(name, hex);
      configs.push({ hex, propertyName: name, defaultColor: normalizeColor(config.defaultColor)?.hex || hex });
    }
    return { valid: errors.length === 0, errors, configs };
  }

  function renderValidation(validation) {
    els.validationSummary.hidden = validation.valid;
    els.validationSummary.innerHTML = validation.errors.map(escapeHtml).join('<br>');
    els.colorList.querySelectorAll('[data-action="name"]').forEach((input) => {
      input.classList.toggle('input-error', Boolean(input.value) && !PROPERTY_NAME_PATTERN.test(input.value.trim()));
    });
  }

  function renderPropertyControls(isValid) {
    const active = [...state.dynamicConfig.values()].filter((config) => config.enabled && PROPERTY_NAME_PATTERN.test(config.propertyName));
    if (!active.length) {
      els.propertyControls.className = 'property-controls empty';
      els.propertyControls.textContent = 'Aktiviere in der Farbliste mindestens eine dynamische Property.';
      return;
    }
    els.propertyControls.className = 'property-controls';
    els.propertyControls.innerHTML = active.map((config) => `
      <div class="property-card">
        <label for="test-${escapeHtml(config.propertyName)}">${escapeHtml(config.propertyName)}</label>
        <input id="test-${escapeHtml(config.propertyName)}" class="color-input" type="color" value="${escapeHtml(state.testValues.get(config.propertyName) || config.defaultColor)}" data-property="${escapeHtml(config.propertyName)}" ${isValid ? '' : 'disabled'}>
      </div>`).join('');
    els.propertyControls.querySelectorAll('[data-property]').forEach((input) => input.addEventListener('input', (event) => {
      state.testValues.set(event.target.dataset.property, event.target.value.toUpperCase());
      const validation = validateConfig();
      renderPreview(els.dynamicPreview, generatePreviewSvg(validation.configs, validation.valid), 'Testvorschau');
    }));
  }

  function generateSvghmi(configs) {
    const doc = parseCleanDocument();
    const svg = doc.documentElement;
    ensureSvgNamespaces(svg);
    svg.setAttribute('xmlns:hmi', HMI_NS);
    svg.setAttribute('xmlns:hmi-bind', HMI_BIND_NS);
    svg.setAttribute('name', buildSvgName(svg.getAttribute('name')));

    svg.querySelector('hmi\\:self')?.remove();
    const self = doc.createElementNS(HMI_NS, 'hmi:self');
    setHmiSelfAttributes(self, buildSvgName(svg.getAttribute('name')));
    for (const config of configs) {
      const param = doc.createElementNS(HMI_NS, 'hmi:paramDef');
      param.setAttribute('name', config.propertyName);
      param.setAttribute('type', 'HmiColor');
      param.setAttribute('default', hexToHmiColor(config.defaultColor));
      self.appendChild(param);
    }
    svg.insertBefore(self, svg.firstElementChild || svg.firstChild);

    for (const el of svg.querySelectorAll('*')) {
      if (el.namespaceURI === HMI_NS) continue;
      for (const attr of COLOR_ATTRIBUTES) {
        if (!el.hasAttribute(attr)) continue;
        const normalized = resolvePaintColor(el.getAttribute(attr), el);
        const config = normalized ? configs.find((item) => item.hex === normalized.hex) : null;
        if (config) {
          el.removeAttribute(attr);
          el.setAttributeNS(HMI_BIND_NS, `hmi-bind:${attr}`, `{{Converter.RGBA(ParamProps.${config.propertyName})}}`);
        }
      }
    }
    return `${HMI_DOCTYPE}\n${serializeSvg(doc)}\n`;
  }

  function generatePreviewSvg(configs, isValid) {
    const doc = parseCleanDocument();
    if (isValid) {
      for (const el of doc.querySelectorAll('*')) {
        for (const attr of COLOR_ATTRIBUTES) {
          if (!el.hasAttribute(attr)) continue;
          const normalized = resolvePaintColor(el.getAttribute(attr), el);
          const config = normalized ? configs.find((item) => item.hex === normalized.hex) : null;
          if (config) el.setAttribute(attr, state.testValues.get(config.propertyName) || config.defaultColor);
        }
      }
    }
    return serializeSvg(doc);
  }

  function parseCleanDocument() {
    return new DOMParser().parseFromString(state.sanitizedSvgText, 'image/svg+xml');
  }

  function renderPreview(container, svgText, alt) {
    const blob = new Blob([svgText], { type: SVG_MIME_TYPE });
    const url = URL.createObjectURL(blob);
    container.dataset.url && URL.revokeObjectURL(container.dataset.url);
    container.dataset.url = url;
    container.className = 'preview-box';
    container.innerHTML = '';
    const img = document.createElement('img');
    img.alt = alt;
    img.src = url;
    container.appendChild(img);
  }

  function revokePreviewUrls() {
    [els.originalPreview, els.dynamicPreview].forEach((container) => {
      if (container.dataset.url) URL.revokeObjectURL(container.dataset.url);
      delete container.dataset.url;
    });
  }

  function resolvePaintColor(value, el) {
    const normalized = normalizeColor(value);
    if (!normalized?.special || normalized.value !== 'currentcolor') return normalized;
    return resolveCurrentColor(el) || { hex: CURRENT_COLOR_FALLBACK };
  }

  function resolveCurrentColor(el) {
    for (let current = el; current; current = current.parentElement) {
      const colorValue = getElementColorValue(current);
      if (!colorValue) continue;
      const normalized = normalizeColor(colorValue);
      if (normalized?.hex) return normalized;
    }
    return null;
  }

  function getElementColorValue(el) {
    const styleColor = parseStyle(el.getAttribute('style')).find(([name]) => name === 'color')?.[1];
    return styleColor || el.getAttribute('color');
  }

  function countCurrentColorPaints(doc) {
    let count = 0;
    for (const el of doc.querySelectorAll('*')) {
      for (const attr of COLOR_ATTRIBUTES) {
        if (el.getAttribute(attr)?.trim().toLowerCase() === 'currentcolor') count += 1;
      }
      const stylePaints = parseStyle(el.getAttribute('style')).filter(([name, value]) => COLOR_ATTRIBUTES.includes(name) && value.trim().toLowerCase() === 'currentcolor');
      count += stylePaints.length;
    }
    return count;
  }

  function normalizeColor(value) {
    if (!value) return null;
    const raw = value.trim();
    const lower = raw.toLowerCase();
    if (['none', 'transparent', 'currentcolor', 'inherit', 'initial', 'unset'].includes(lower)) return { special: true, value: lower };
    if (/^#[0-9a-f]{3}$/i.test(raw)) return { hex: `#${raw.slice(1).split('').map((c) => c + c).join('').toUpperCase()}` };
    if (/^#[0-9a-f]{6}$/i.test(raw)) return { hex: raw.toUpperCase() };
    const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
    if (rgb) {
      const parts = rgb[1].split(',').map((part) => part.trim());
      if (parts.length >= 3 && parts[3] !== '0') {
        const nums = parts.slice(0, 3).map((part) => part.endsWith('%') ? Math.round(parseFloat(part) * 2.55) : parseInt(part, 10));
        if (nums.every((num) => Number.isFinite(num))) return { hex: rgbToHex(nums[0], nums[1], nums[2]) };
      }
      if (parts[3] === '0') return { special: true, value: 'transparent' };
    }
    if (NAMED_COLORS[lower]) {
      return NAMED_COLORS[lower] === 'transparent' ? { special: true, value: 'transparent' } : { hex: NAMED_COLORS[lower] };
    }
    return null;
  }

  function rgbToHex(r, g, b) {
    return `#${[r, g, b].map((num) => Math.max(0, Math.min(255, num)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }

  function parseStyle(styleText) {
    return String(styleText || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const separator = part.indexOf(':');
      return separator === -1 ? [part.toLowerCase(), ''] : [part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim()];
    });
  }

  function ensureSvgNamespaces(svg) {
    svg.setAttribute('xmlns', SVG_NS);
    svg.removeAttribute('xmlns:html');
  }

  function serializeSvg(doc) {
    return new XMLSerializer().serializeToString(doc.documentElement).replace(/></g, '>\n<');
  }

  function addCountWarning(warnings, count, title, message, level) {
    if (count) warnings.push({ title: `${title} (${count})`, message, level });
  }

  function suggestPropertyName(hex, index) {
    const friendly = { '#FF0000': 'AlarmColor', '#00FF00': 'OkColor', '#0000FF': 'InfoColor', '#000000': 'StrokeColor', '#FFFFFF': 'BodyColor' };
    return friendly[hex] || `Color_${index}`;
  }

  function hexToHmiColor(hex) { return `0xFF${hex.replace('#', '').toUpperCase()}`; }
  function formatBytes(bytes) { return `${(bytes / 1024).toFixed(bytes > 1024 * 1024 ? 1 : 0)} KB`; }
  function buildExportFileName() { return `${baseFileName()}_dynamic.svghmi`; }
  function setHmiSelfAttributes(self, svgName) {
    self.setAttribute('type', 'widget');
    self.setAttribute('displayName', svgName);
    self.setAttribute('name', `extended.${svgName}`);
    self.setAttribute('version', '1.0.0');
    self.setAttribute('performanceClass', 'L');
  }
  function buildSvgName(existingName) { return sanitizeSvgName(String(existingName || '').trim() || baseFileName()); }
  function sanitizeSvgName(value) {
    const cleaned = String(value || '').replace(/\.svg$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    if (!cleaned) return 'SvgGraphic';
    return /^[A-Za-z_]/.test(cleaned) ? cleaned : `Svg_${cleaned}`;
  }
  function buildCleanFileName() { return `${baseFileName()}_clean.svg`; }
  function baseFileName() { return (state.fileName || 'export.svg').replace(/\.svg$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_'); }

  function setStatus(message, isError = false, isSuccess = false) {
    els.status.textContent = message;
    els.status.className = `status${isError ? ' error' : ''}${isSuccess ? ' success' : ''}`;
  }

  function setExportEnabled(enabled) {
    els.downloadButton.disabled = !enabled;
    els.copyButton.disabled = !enabled;
  }

  function downloadText(fileName, text, mimeType) {
    const url = URL.createObjectURL(new Blob([text], { type: `${mimeType};charset=utf-8` }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function copyGeneratedCode() {
    try {
      await navigator.clipboard.writeText(state.generatedCode);
      setStatus('SVGHMI-Code wurde in die Zwischenablage kopiert.', false, true);
    } catch {
      els.codeOutput.select();
      document.execCommand('copy');
      setStatus('SVGHMI-Code wurde kopiert (Fallback-Methode).', false, true);
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }
})();
