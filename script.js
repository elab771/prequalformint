/* ====== Lazy-load heavy PDF libraries ====== */
var PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var PDFJS_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
var PDFLIB_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';

var _scriptLoadPromises = {};
function loadScriptOnce(src) {
  if (_scriptLoadPromises[src]) return _scriptLoadPromises[src];
  _scriptLoadPromises[src] = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = function() { resolve(); };
    s.onerror = function() { reject(new Error('Failed to load script: ' + src)); };
    document.head.appendChild(s);
  });
  return _scriptLoadPromises[src];
}

function ensurePdfJsLoaded() {
  if (typeof pdfjsLib !== 'undefined') return Promise.resolve();
  return loadScriptOnce(PDFJS_SRC).then(function() {
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    }
  });
}

function ensurePdfLibLoaded() {
  if (typeof PDFLib !== 'undefined') return Promise.resolve();
  return loadScriptOnce(PDFLIB_SRC);
}

/* ====== iOS / iPadOS detection ====== */
function isIOS() {
  return /iP(hone|od|ad)/.test(navigator.userAgent) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/* ====== Lock Form on Load ====== */
function lockEntireForm() {
  var container = document.querySelector('.page-container');
  if (!container) return;
  
  container.querySelectorAll('input, select, textarea, button').forEach(function(el) {
    if (el.tagName === 'SELECT' || el.tagName === 'BUTTON' || el.type === 'file' || el.type === 'date') {
      el.disabled = true;
    } else {
      el.setAttribute('readonly', 'readonly');
    }
    el.classList.add('upload-mode-locked');
  });
  
  container.querySelectorAll('.date-cal-btn, [id^="sig-btns-"]').forEach(function(el) {
    el.style.pointerEvents = 'none';
  });
  container.querySelectorAll('label[for^="sig-input-"]').forEach(function(el) {
    el.style.pointerEvents = 'none';
  });
  uploadModeActive = false;
}

/* ====== Auto-resizing fields ====== */
function autoResizeField(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function initAutoResizeFields() {
  var fields = document.querySelectorAll('.auto-resize-field');
  fields.forEach(function(el) {
    autoResizeField(el);
    el.addEventListener('input', function() { autoResizeField(el); });
  });
  window.addEventListener('resize', function() {
    fields.forEach(autoResizeField);
  });
}
initAutoResizeFields();

/* ====== Mobile page scaling ====== */
var MOBILE_BREAKPOINT = 820;
function scalePageForMobile() {
  var wrapper = document.querySelector('.page-scale-wrapper');
  var page = document.querySelector('.page-container');
  if (!wrapper || !page) return;

  if (window.innerWidth > MOBILE_BREAKPOINT) {
    page.style.transform = '';
    wrapper.style.width = '';
    wrapper.style.height = '';
    wrapper.style.margin = '';
    return;
  }

  wrapper.style.width = '100%';
  page.style.transform = 'none';
  var naturalWidth = page.offsetWidth;
  var naturalHeight = page.offsetHeight;
  if (!naturalWidth) return;

  var viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  var availableWidth = viewportWidth - 16; 
  var scale = Math.min(1, availableWidth / naturalWidth);

  page.style.transform = 'scale(' + scale + ')';
  wrapper.style.width = (naturalWidth * scale) + 'px';
  wrapper.style.height = (naturalHeight * scale) + 'px';
  wrapper.style.margin = '8px auto 20px auto';
}

var scaleResizeTimer = null;
function scheduleScalePageForMobile() {
  if (scaleResizeTimer) clearTimeout(scaleResizeTimer);
  scaleResizeTimer = setTimeout(scalePageForMobile, 120);
}

window.addEventListener('load', scalePageForMobile);
window.addEventListener('resize', scheduleScalePageForMobile);
window.addEventListener('orientationchange', scheduleScalePageForMobile);
document.addEventListener('input', scheduleScalePageForMobile);
var pageContainerEl = document.querySelector('.page-container');
if (pageContainerEl && window.MutationObserver) {
  new MutationObserver(scheduleScalePageForMobile).observe(pageContainerEl, {
    childList: true, subtree: true, attributes: true
  });
}

/* ====== Signature helpers ====== */
var SIG_MAX_WIDTH = 600;
var SIG_MAX_HEIGHT = 220;
var SIG_TARGET_BYTES = 250 * 1024;
var SIG_MIN_QUALITY = 0.75;
var SIG_MIN_DIMENSION_SCALE = 0.5;

function loadSig(input, uid) {
  var file = input.files[0];
  if (!file) return;
  compressSignatureImage(file).then(function(dataUrl) {
    var img = document.getElementById('sig-img-' + uid);
    img.src = dataUrl;
    img.style.display = 'block';
    if (typeof saveFormState === 'function') saveFormState();
  }).catch(function(err) {
    console.warn('Signature compression failed, using original file instead.', err);
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = document.getElementById('sig-img-' + uid);
      img.src = e.target.result;
      img.style.display = 'block';
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function compressSignatureImage(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function() { reject(new Error('Could not read file.')); };
    reader.onload = function(e) {
      var img = new Image();
      img.onerror = function() { reject(new Error('Could not decode image.')); };
      img.onload = function() {
        try {
          function approxBytes(dataUrl) {
            var b64 = dataUrl.split(',')[1] || '';
            return Math.round(b64.length * 0.75);
          }

          function renderAt(dimScale) {
            var scale = Math.min(1, SIG_MAX_WIDTH / img.width, SIG_MAX_HEIGHT / img.height) * dimScale;
            var w = Math.max(1, Math.round(img.width * scale));
            var h = Math.max(1, Math.round(img.height * scale));

            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            return canvas;
          }

          var canvas = renderAt(1);
          var quality = 0.92;
          var dataUrl = canvas.toDataURL('image/jpeg', quality);
          while (approxBytes(dataUrl) > SIG_TARGET_BYTES && quality > SIG_MIN_QUALITY) {
            quality -= 0.05;
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }

          var dimScale = 1;
          while (approxBytes(dataUrl) > SIG_TARGET_BYTES && dimScale > SIG_MIN_DIMENSION_SCALE) {
            dimScale -= 0.1;
            canvas = renderAt(dimScale);
            dataUrl = canvas.toDataURL('image/jpeg', SIG_MIN_QUALITY);
          }

          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function clearSig(uid) {
  var img = document.getElementById('sig-img-' + uid);
  img.src = '';
  img.style.display = 'none';
}

/* ====== Date formatting ====== */
function formatDateField(picker) {
  var val = picker.value;
  var display = picker.parentNode.querySelector('.date-display');
  if (!val || !display) { if(display) display.value = ''; return; }
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var parts = val.split('-');
  var y = parts[0];
  var m = parseInt(parts[1], 10) - 1;
  var d = parts[2];
  display.value = d + '-' + months[m] + '-' + y;
  picker.classList.remove('ios-fallback-active');
}

function openDatePicker(btn) {
  var picker = btn.parentNode.querySelector('.date-hidden-picker');
  if (!picker) return;

  if (typeof picker.showPicker === 'function') {
    try {
      picker.showPicker();
      return;
    } catch (e) { }
  }

  picker.classList.add('ios-fallback-active');
  picker.focus();
  if (typeof picker.click === 'function') {
    picker.click();
  }

  setTimeout(function() {
    if (document.activeElement !== picker) {
      picker.classList.remove('ios-fallback-active');
    }
  }, 4000);

  picker.addEventListener('blur', function onBlur() {
    picker.classList.remove('ios-fallback-active');
    picker.removeEventListener('blur', onBlur);
  });
}

/* ====== Upload Modal ====== */
function openUploadModal() {
  document.getElementById('upload-modal').classList.add('active');
  document.getElementById('pdf-file-input').value = '';
  document.getElementById('upload-modal-msg').style.display = 'none';
  document.getElementById('upload-modal-msg').textContent = '';
}
function closeUploadModal() {
  document.getElementById('upload-modal').classList.remove('active');
}
function showModalMsg(msg) {
  var el = document.getElementById('upload-modal-msg');
  el.textContent = msg;
  el.style.display = 'block';
}

/* ====== PDF Processing ====== */
async function processUploadedPDF() {
  var input = document.getElementById('pdf-file-input');
  var file = input.files[0];
  if (!file) { showModalMsg('Please select a PDF file.'); return; }
  showModalMsg('Loading PDF tools, please wait...');
  try {
    await ensurePdfJsLoaded();
  } catch (e) {
    showModalMsg('Could not load the PDF library. Please check your internet connection and try again.');
    return;
  }
  showModalMsg('Processing PDF, please wait...');
  try {
    var arrayBuffer = await file.arrayBuffer();
    if (typeof pdfjsLib === 'undefined') {
      showModalMsg('PDF library not loaded. Please check your internet connection.');
      return;
    }
    var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    var fieldMap = await buildFieldMap(pdf);
    if (!fieldMap || Object.keys(fieldMap).length === 0) {
      showModalMsg('Could not find any recognizable form fields on the first page of this PDF.');
      return;
    }
    extractAndPopulateForm(fieldMap);
    closeUploadModal();
  } catch(e) {
    showModalMsg('Error reading PDF: ' + e.message);
  }
}

async function buildFieldMap(pdf) {
  var map = {};
  try {
    var fieldObjects = await pdf.getFieldObjects();
    if (fieldObjects) {
      Object.keys(fieldObjects).forEach(function(name) {
        var arr = fieldObjects[name];
        if (arr && arr.length && arr[0].value !== undefined) {
          map[name] = arr[0].value;
        }
      });
    }
  } catch (e) { }

  try {
    var page = await pdf.getPage(1);
    var annots = await page.getAnnotations({ intent: 'display' });
    annots.forEach(function(a) {
      if (a.fieldName && !(a.fieldName in map)) {
        map[a.fieldName] = a.fieldValue;
      }
    });
  } catch (e) { }
  return map;
}

/* ====== State tracking & Field Maps ====== */
var uploadModeActive = false;
var blankQualSelects = [];

var PROFILE_FIELD_MAP = [
  'txtengrname', 'txtcompanyname', 'txtnationality',
  'txttotalexpyr', 'txttotalexpmo', 'txtidentityno',
  'txtexpksayr', 'txtexpksamo', 'txtmobileno'
];

var QUAL_FIELD_MAP = [
  'txtbattcharger', 'ctxtbattcharger',
  'txtacdbdcdb', 'ctxtacdbdcdb',
  'txtauxtriprelaysmccb', 'ctxtauxtriprelaysmccb',
  'txtmeters', 'ctxtmeters',
  'txtxfrmrmv', 'txtxfrmrhv', 'txtxfrmrehv', 'ctxtxfrmrmv', 'ctxtxfrmrhv', 'ctxtxfrmrehv',
  'txtshuntmv', 'txtshunthv', 'txtshuntehv', 'ctxtshuntmv', 'ctxtshunthv', 'ctxtshuntehv',
  'txtcapmv', 'txtcaphv', 'txtcapehv', 'ctxtcapmv', 'ctxtcaphv', 'ctxtcapehv',
  'txtohtl', 'ctxtohtl',
  'txtcableelecmv', 'txtcableelechv', 'txtcableelecehv', 'ctxtcableelecmv', 'ctxtcableelechv', 'ctxtcableelecehv',
  'txtcablehvmv', 'txtcablehvhv', 'txtcablehvehv', 'ctxtcablehvmv', 'ctxtcablehvhv', 'ctxtcablehvehv',
  'txtcablepdmv', 'txtcablepdhv', 'txtcablepdehv', 'ctxtcablepdmv', 'ctxtcablepdhv', 'ctxtcablepdehv',
  'txtswgrmv', 'txtswgrhv', 'txtswgrehv', 'ctxtswgrmv', 'ctxtswgrhv', 'ctxtswgrehv',
  'txtswgrhvmv', 'txtswgrhvhv', 'txtswgrhvehv', 'ctxtswgrhvmv', 'ctxtswgrhvhv', 'ctxtswgrhvehv',
  'txtswgrpdmv', 'txtswgrpdhv', 'txtswgrpdehv', 'ctxtswgrpdmv', 'ctxtswgrpdhv', 'ctxtswgrpdehv',
  'txtschememv', 'txtschemehv', 'txtschemeehv', 'ctxtschememv', 'ctxtschemehv', 'ctxtschemeehv',
  'txtctmv', 'txtcthv', 'txtctehv', 'ctxtctmv', 'ctxtcthv', 'ctxtctehv',
  'txtvtsecmv', 'txtvtsechv', 'txtvtsecehv', 'ctxtvtsecmv', 'ctxtvtsechv', 'ctxtvtsecehv',
  'txtsimplerelaysmv', 'txtsimplerelayshv', 'txtsimplerelaysehv', 'ctxtsimplerelaysmv', 'ctxtsimplerelayshv', 'ctxtsimplerelaysehv',
  'txtadvancedprotmv', 'txtadvancedprothv', 'txtadvancedprotehv', 'ctxtadvancedprotmv', 'ctxtadvancedprothv', 'ctxtadvancedprotehv',
  'txtstabmv', 'txtstabhv', 'txtstabehv', 'ctxtstabmv', 'ctxtstabhv', 'ctxtstabehv',
  'txtendtoendhv', 'txtendtoendehv', 'ctxtendtoendhv', 'ctxtendtoendehv',
  'txtfttmv', 'txtftthv', 'txtfttehv', 'ctxtfttmv', 'ctxtftthv', 'ctxtfttehv',
  'txtlivess', 'ctxtlivess',
  'txtschv', 'txtscehv', 'ctxtschv', 'ctxtscehv'
];

function getFieldValue(fieldMap, name) {
  if (!(name in fieldMap)) return null;
  var v = fieldMap[name];
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) v = v[0];
  v = String(v).trim();
  return v.length ? v : null;
}

/* ====== Field extraction and form population ====== */
function extractAndPopulateForm(fieldMap) {
  resetUploadMode();

  var engineerProfileInputs = getEngineerProfileInputs();
  for (var p = 0; p < PROFILE_FIELD_MAP.length && p < engineerProfileInputs.length; p++) {
    var val = getFieldValue(fieldMap, PROFILE_FIELD_MAP[p]);
    engineerProfileInputs[p].value = val || '';
    if (engineerProfileInputs[p].classList.contains('auto-resize-field')) {
      autoResizeField(engineerProfileInputs[p]);
    }
  }

  var qualSelects = getQualificationSelects();
  blankQualSelects = [];

  for (var i = 0; i < qualSelects.length; i++) {
    var sel = qualSelects[i];
    var fieldName = QUAL_FIELD_MAP[i];
    var isCsdField = fieldName && fieldName.indexOf('ctxt') === 0;
    var txtFieldName = isCsdField ? fieldName.slice(1) : fieldName;
    var ctxtFieldName = isCsdField ? fieldName : ('c' + fieldName);
    var txtRawVal = txtFieldName ? getFieldValue(fieldMap, txtFieldName) : null;
    var ctxtRawVal = ctxtFieldName ? getFieldValue(fieldMap, ctxtFieldName) : null;
    var txtIsNo = !!(txtRawVal && txtRawVal.toUpperCase() === 'NO');
    var ctxtIsBlank = !ctxtRawVal;

    if (txtIsNo) {
      flattenSelect(sel, 'NO');
    } else if (ctxtIsBlank) {
      if (isCsdField) {
        if (!sel.querySelector('option[value=""]')) {
          var blankOpt = document.createElement('option');
          blankOpt.value = '';
          blankOpt.text = '';
          sel.insertBefore(blankOpt, sel.firstChild);
        }
        sel.value = '';
        sel.classList.add('qual-blank-highlight');
        sel.classList.remove('upload-mode-locked');
        sel.removeAttribute('disabled');
        blankQualSelects.push(sel);
      } else {
        flattenSelect(sel, 'YES');
      }
    } else {
      var ownRawVal = isCsdField ? ctxtRawVal : txtRawVal;
      flattenSelect(sel, ownRawVal || '');
    }
  }

  lockNonEditableFields();

  uploadModeActive = true;
  if (typeof scheduleScalePageForMobile === 'function') scheduleScalePageForMobile();
  alert('PDF data loaded successfully.\n\nFields highlighted in RED must be filled in before printing.\nFill the blank qualification fields, Interviewer names, DQC name, dates, and signatures.\n\nRemarks fields (highlighted in YELLOW once a dropdown is set to *YES) are only unlocked for rows that still have a fillable dropdown, and must be filled whenever *YES is selected.');
}

function getEngineerProfileInputs() {
  var docInfo = document.querySelector('.doc-info');
  if (!docInfo) return [];
  return Array.from(docInfo.querySelectorAll('input[type="text"], textarea'));
}

function getQualificationSelects() {
  var qualTable = document.querySelector('.qual-table');
  if (!qualTable) return [];
  qualTable.querySelectorAll('select.flattened-select').forEach(function(s) {
    unflattenSelect(s);
  });
  return Array.from(qualTable.querySelectorAll('tbody select'));
}

function flattenSelect(sel, value) {
  sel.value = value;
  sel.classList.add('flattened-select');
  sel.style.display = 'none';
  sel.setAttribute('disabled', 'disabled');

  var span = sel.nextElementSibling;
  if (!span || !span.classList || !span.classList.contains('flattened-cell-value')) {
    span = document.createElement('span');
    span.className = 'flattened-cell-value';
    sel.parentNode.insertBefore(span, sel.nextSibling);
  }
  span.textContent = value;
}

function unflattenSelect(sel) {
  sel.classList.remove('flattened-select');
  sel.style.display = '';
  sel.removeAttribute('disabled');

  var span = sel.nextElementSibling;
  if (span && span.classList && span.classList.contains('flattened-cell-value')) {
    span.parentNode.removeChild(span);
  }
}

function lockNonEditableFields() {
  var docInfo = document.querySelector('.doc-info');
  if (docInfo) {
    docInfo.querySelectorAll('input[type="text"], textarea').forEach(function(inp) {
      inp.setAttribute('readonly', 'readonly');
      inp.classList.add('upload-mode-locked');
    });
  }

  var furtherRemarksEl = getFurtherRemarksTextarea();
  if (furtherRemarksEl) {
    furtherRemarksEl.removeAttribute('readonly');
    furtherRemarksEl.classList.remove('upload-mode-locked');
  }

  applyRemarksLockRules();

  var footerTables = document.querySelectorAll('.remarks-section table');
  footerTables.forEach(function(ft) {
    ft.querySelectorAll('input[type="text"]').forEach(function(inp) {
      inp.removeAttribute('readonly');
      inp.classList.remove('upload-mode-locked');
    });
    ft.querySelectorAll('.date-cal-btn').forEach(function(btn) {
      btn.style.pointerEvents = '';
    });
    ft.querySelectorAll('.date-hidden-picker').forEach(function(picker) {
      picker.style.pointerEvents = '';
    });
  });

  document.querySelectorAll('[id^="sig-input-"]').forEach(function(el) {
    el.removeAttribute('disabled');
  });
  document.querySelectorAll('[id^="sig-btns-"], label[for^="sig-input-"]').forEach(function(el) {
    el.style.pointerEvents = '';
  });
}

function applyRemarksLockRules() {
  var rows = getQualDataRows();
  var remarksInputs = getQualRemarksInputs();

  rows.forEach(function(row, idx) {
    var remarksInput = remarksInputs[idx];
    if (!remarksInput) return;

    var rowFillableSelects = Array.from(row.querySelectorAll('select')).filter(function(sel) {
      return blankQualSelects.indexOf(sel) !== -1;
    });

    if (rowFillableSelects.length === 0) {
      remarksInput.setAttribute('readonly', 'readonly');
      remarksInput.classList.add('upload-mode-locked');
      remarksInput.classList.remove('remarks-blank-highlight');
      return;
    }

    updateRowRemarksState(remarksInput, rowFillableSelects);
    rowFillableSelects.forEach(function(sel) {
      if (!sel._remarksListenerAttached) {
        sel.addEventListener('change', function() {
          updateRowRemarksState(remarksInput, rowFillableSelects);
        });
        sel._remarksListenerAttached = true;
      }
    });
  });
}

function updateRowRemarksState(remarksInput, fillableSelects) {
  var hasStarYes = fillableSelects.some(function(sel) { return sel.value === '*YES'; });
  if (hasStarYes) {
    remarksInput.removeAttribute('readonly');
    remarksInput.classList.remove('upload-mode-locked');
    remarksInput.classList.add('remarks-blank-highlight');
  } else {
    remarksInput.value = '';
    remarksInput.setAttribute('readonly', 'readonly');
    remarksInput.classList.add('upload-mode-locked');
    remarksInput.classList.remove('remarks-blank-highlight');
  }
}

function resetUploadMode() {
  uploadModeActive = false;
  blankQualSelects = [];
  document.querySelectorAll('.upload-mode-locked').forEach(function(el) {
    el.classList.remove('upload-mode-locked');
    el.removeAttribute('readonly');
    el.removeAttribute('disabled');
  });
  document.querySelectorAll('.qual-blank-highlight').forEach(function(el) {
    el.classList.remove('qual-blank-highlight');
  });
  document.querySelectorAll('.remarks-blank-highlight').forEach(function(el) {
    el.classList.remove('remarks-blank-highlight');
  });
  document.querySelectorAll('select.flattened-select').forEach(function(sel) {
    unflattenSelect(sel);
  });
  document.querySelectorAll('select option[value=""]').forEach(function(opt) {
    opt.parentNode.removeChild(opt);
  });
  document.querySelectorAll('.date-cal-btn, [id^="sig-btns-"], label[for^="sig-input-"]').forEach(function(el) {
    el.style.pointerEvents = '';
  });
}

/* ====== Remarks / row helpers ====== */
var REMARKS_FIELD_MAP = [
  'txtr_battcharger', 'txtr_acdbdcdb', 'txtr_auxtripmccb', 'txtr_meters',
  'txtr_xfrmr', 'txtr_shunt', 'txtr_capacitor', 'txtr_ohtl',
  'txtr_cableelec', 'txtr_cablehv', 'txtr_cablepd', 'txtr_swgreqpt',
  'txtr_swgrhv', 'txtr_swgrpd', 'txtr_schemecheck', 'txtr_ctprisec',
  'txtr_vtsec', 'txtr_simplerelays', 'txtr_advanceprot', 'txtr_stability',
  'txtr_endtoend', 'txtr_ftt', 'txtr_livess', 'txtr_sitecoor'
];

var QUAL_ROW_NAMES = [
  'Batteries&Chargers', 'ACDB&DCDB', 'Aux./Trip Relays&MCCB', 'Meters',
  'Power Transformer', 'Shunt Reactor', 'Capacitor', 'OHTL',
  'Power Cable Electrical Tests', 'Power Cable HV Test', 'Power Cable PD Test',
  'Switchgear Equipment', 'Switchgear HV Test', 'Switchgear PD Test',
  'Scheme Check', 'CT Primary&Secondary Injection', 'VT Secondary Injection',
  'Simple Protection Relays', 'Advanced Protection&Control IEDs', 'Stability Test',
  'End To End Test', 'Final Trip Test', 'Live Substations', 'Site Coordinator'
];

function getQualDataRows() {
  var qualTable = document.querySelector('.qual-table');
  if (!qualTable) return [];
  return Array.from(qualTable.querySelectorAll('tbody > tr')).filter(function(row) {
    return row.querySelectorAll('td').length > 1;
  });
}

function getQualRemarksInputs() {
  return getQualDataRows().map(function(row) {
    var tds = row.querySelectorAll('td');
    var lastTd = tds[tds.length - 1];
    return lastTd ? lastTd.querySelector('input[type="text"]') : null;
  });
}

function getFurtherRemarksTextarea() {
  return document.getElementById('further-remarks-textarea');
}

function getExaminerRows() {
  var footerTables = document.querySelectorAll('.remarks-section table');
  if (!footerTables.length) return {};
  var rows = footerTables[0].querySelectorAll('tr');
  return { ex1: rows[1] || null, ex2: rows[2] || null };
}

/* ====== Print Validation ====== */
function validateAndPrint() {
  var missing = [];
  var firstInvalidEl = null;
  function flag(label, el) {
    missing.push(label);
    if (!firstInvalidEl && el) firstInvalidEl = el;
  }

  if (uploadModeActive) {
    var unfilledQuals = blankQualSelects.filter(function(sel) {
      return sel.value === '' || sel.value === null;
    });
    if (unfilledQuals.length > 0) {
      alert('Please fill in all highlighted (red) qualification fields before printing.\n' +
            unfilledQuals.length + ' field(s) still need to be filled.');
      unfilledQuals[0].focus();
      return;
    }
  }

  var profileLabels = ['Name', 'Company Name', 'Nationality', 'Total Experience (Years)',
                        'Total Experience (Months)', 'Identity No', 'Experience in KSA (Years)',
                        'Experience in KSA (Months)', 'Contact No'];
  var profileInputs = getEngineerProfileInputs();
  profileInputs.forEach(function(inp, idx) {
    var enabled = !inp.disabled && !inp.hasAttribute('readonly');
    if (enabled && !inp.value.trim()) flag(profileLabels[idx] || ('Profile field ' + (idx + 1)), inp);
  });

  var dataRows = getQualDataRows();
  var remarksInputs = getQualRemarksInputs();
  dataRows.forEach(function(row, idx) {
    var selects = Array.from(row.querySelectorAll('select')).filter(function(sel) { return !sel.disabled; });
    var hasStarYes = selects.some(function(sel) { return sel.value === '*YES'; });
    if (hasStarYes) {
      var remarksInput = remarksInputs[idx];
      if (remarksInput && !remarksInput.value.trim()) {
        flag('Remarks for Row ' + (idx + 1) + ' (' + (QUAL_ROW_NAMES[idx] || '') + ') - required because "*YES" was selected', remarksInput);
      }
    }
  });

  var examRows = getExaminerRows();
  if (examRows.ex1) {
    var ex1Name = examRows.ex1.querySelector('input[type="text"]');
    var ex1Date = examRows.ex1.querySelector('.date-display');
    var ex1Sig = examRows.ex1.querySelector('img[id^="sig-img-"]');
    if (ex1Name && !ex1Name.value.trim()) flag('Examiner 1 Name', ex1Name);
    if (ex1Date && !ex1Date.value.trim()) flag('Examiner 1 Date', ex1Date);
    if (ex1Sig && ex1Sig.src.indexOf('data:') !== 0) flag('Examiner 1 Signature', null);
  }

  if (examRows.ex2) {
    var ex2Name = examRows.ex2.querySelector('input[type="text"]');
    var ex2Date = examRows.ex2.querySelector('.date-display');
    var ex2Sig = examRows.ex2.querySelector('img[id^="sig-img-"]');
    var ex2NameVal = ex2Name ? ex2Name.value.trim() : '';
    var ex2DateVal = ex2Date ? ex2Date.value.trim() : '';
    var ex2SigVal = !!(ex2Sig && ex2Sig.src && ex2Sig.src.indexOf('data:') === 0);
    var ex2AnyFilled = !!(ex2NameVal || ex2DateVal || ex2SigVal);
    var ex2AllFilled = !!(ex2NameVal && ex2DateVal && ex2SigVal);
    if (ex2AnyFilled && !ex2AllFilled) {
      if (!ex2NameVal) flag('Examiner 2 Name', ex2Name);
      if (!ex2DateVal) flag('Examiner 2 Date', ex2Date);
      if (!ex2SigVal) flag('Examiner 2 Signature', null);
    }
  }

  if (missing.length > 0) {
    alert('The following required fields are not filled:\n- ' + missing.join('\n- ') +
          '\n\nPlease complete them before printing.');
    if (firstInvalidEl && typeof firstInvalidEl.focus === 'function') firstInvalidEl.focus();
    return;
  }

  generateFilledPdf();
}

/* ====== Filename helpers ====== */
function getCompanyId(companyName) {
  if (!companyName) return 'UNKNOWN';
  var trimmed = companyName.trim();
  if (!trimmed) return 'UNKNOWN';
  var idx = trimmed.search(/[\s-]/);
  var id = (idx === -1) ? trimmed : trimmed.substring(0, idx);
  id = id.trim();
  return id || 'UNKNOWN';
}

function formatDdMmmYy(date) {
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function pad2(n) { return String(n).padStart(2, '0'); }
  var dd = pad2(date.getDate());
  var mmm = months[date.getMonth()];
  var yy = String(date.getFullYear()).slice(-2);
  return dd + mmm + yy;
}

/* ====== Output PDF Locking ====== */
var DQC_EDITABLE_FIELD_NAMES = [
  'txtdivqualcoor',
  'txtdivqualcoorsigndate',
  'imgsigdivcoor',
  'btn_addimg',
  'btn_delimg',
  'HiddenBlank'
];

function lockAllFieldsExcept(form, editableNames) {
  var editableSet = {};
  editableNames.forEach(function(n) { editableSet[n] = true; });

  form.getFields().forEach(function(field) {
    var name = field.getName();
    var leaf = name.indexOf('.') !== -1 ? name.slice(name.lastIndexOf('.') + 1) : name;
    if (editableSet[name] || editableSet[leaf]) return;

    try {
      if (typeof field.enableReadOnly === 'function') {
        field.enableReadOnly();
      }
    } catch (e) {
      console.warn('Could not lock PDF field:', name, e.message);
    }
  });
}

/* ====== Official PDF Generation ====== */
var templatePdfBytesCache = null;

async function loadTemplatePdfBytes() {
  if (templatePdfBytesCache) return templatePdfBytesCache;
  var res = await fetch('prequalform_int.pdf', { cache: 'force-cache' });
  if (!res.ok) throw new Error('Could not load "prequalform_int.pdf" (HTTP ' + res.status + '). Make sure this file is placed in the same folder as this form.');
  templatePdfBytesCache = await res.arrayBuffer();
  return templatePdfBytesCache;
}

async function generateFilledPdf() {
  var printBtn = document.getElementById('print-form-btn');
  var printBtnOriginalText = printBtn ? printBtn.textContent : null;
  if (printBtn) {
    printBtn.disabled = true;
    printBtn.textContent = 'Loading…';
  }

  try {
    await ensurePdfLibLoaded();
  } catch (e) {
    alert('The PDF generation library did not load. Please check your internet connection and try again.');
    if (printBtn) {
      printBtn.disabled = false;
      printBtn.textContent = printBtnOriginalText || 'Print Form';
    }
    return;
  }

  if (typeof PDFLib === 'undefined') {
    alert('The PDF generation library did not load. Please check your internet connection and try again.');
    if (printBtn) {
      printBtn.disabled = false;
      printBtn.textContent = printBtnOriginalText || 'Print Form';
    }
    return;
  }
  
  var PDFDocument = PDFLib.PDFDocument;
  var StandardFonts = PDFLib.StandardFonts;
  var ImageAlignment = PDFLib.ImageAlignment;
  var PDFName = PDFLib.PDFName; 
  var AnnotationFlags = PDFLib.AnnotationFlags;

  if (printBtn) {
    printBtn.textContent = 'Generating…';
  }

  try {
    var templateBytes = await loadTemplatePdfBytes();
    var existingPdfBytes = templateBytes.slice(0);

    var pdfDoc = await PDFDocument.load(existingPdfBytes);
    var form = pdfDoc.getForm();
    
    if (form.acroForm) {
      form.acroForm.dict.delete(PDFName.of('NeedAppearances'));
    }

    var helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    var COLOR_NO = [1, 0, 0];       
    var COLOR_YES = [0, 0.5, 0];    
    var COLOR_STARYES = [0, 0, 1];  
    var COLOR_REMARKS = [0, 0, 1];  

    function setTextSafe(name, value, styleOpts) {
      var candidates = [name];
      if (name.indexOf('undefined.') !== 0) candidates.push('undefined.' + name);
      if (name.indexOf('.') === 0) candidates.push(name.slice(1));
      else candidates.push('.' + name);

      for (var c = 0; c < candidates.length; c++) {
        try {
          var field = form.getTextField(candidates[c]);
          field.setText(value || '');
          var useFont = helvBold; // Force bold on PDF output fields
          try {
            var daParts = [];
            if (styleOpts && styleOpts.color) daParts.push(styleOpts.color.join(' ') + ' rg');
            daParts.push('/Helv-Bold 0 Tf');
            field.acroField.setDefaultAppearance(daParts.join(' '));
          } catch (e2) { }

          field.updateAppearances(useFont);
          
          // Lock widgets to restrict editing
          field.enableReadOnly();
          if (typeof AnnotationFlags !== 'undefined') {
            var widgets = field.acroField.getWidgets();
            widgets.forEach(function(w) {
              w.setFlagTo(AnnotationFlags.ReadOnly, true);
              w.setFlagTo(AnnotationFlags.Locked, true);
              w.setFlagTo(AnnotationFlags.LockedContents, true);
            });
          }
          return;
        } catch (e) { }
      }
      console.warn('PDF field not found under any known name variant:', name);
    }

    async function setSigSafe(name, imgEl) {
      if (!imgEl || !imgEl.src || imgEl.src.indexOf('data:') !== 0) return;
      try {
        var res = await fetch(imgEl.src);
        var bytes = await res.arrayBuffer();
        var img = (imgEl.src.indexOf('image/png') !== -1) ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
        var btn = form.getButton(name);
        btn.setImage(img, ImageAlignment ? ImageAlignment.Center : undefined);
        
        btn.enableReadOnly();
        if (typeof AnnotationFlags !== 'undefined') {
          var widgets = btn.acroField.getWidgets();
          widgets.forEach(function(w) {
            w.setFlagTo(AnnotationFlags.ReadOnly, true);
            w.setFlagTo(AnnotationFlags.Locked, true);
            w.setFlagTo(AnnotationFlags.LockedContents, true);
          });
        }
      } catch (e) {
        console.warn('Could not embed signature image into PDF field:', name, e.message);
      }
    }

    var profileInputs = getEngineerProfileInputs();
    for (var p = 0; p < PROFILE_FIELD_MAP.length && p < profileInputs.length; p++) {
      setTextSafe(PROFILE_FIELD_MAP[p], profileInputs[p].value.trim(), { bold: true });
    }

    var qualSelects = getQualificationSelects();
    for (var i = 0; i < qualSelects.length && i < QUAL_FIELD_MAP.length; i++) {
      var qFieldName = QUAL_FIELD_MAP[i];
      var qValue = qualSelects[i].value;
      var qIsCsdField = qFieldName && qFieldName.indexOf('ctxt') === 0;
      var qStyle = { bold: true };
      if (qIsCsdField) {
        if (qValue === 'NO') qStyle.color = COLOR_NO;
        else if (qValue === 'YES') qStyle.color = COLOR_YES;
        else if (qValue === '*YES') qStyle.color = COLOR_STARYES;
      }
      setTextSafe(qFieldName, qValue, qStyle);
    }

    var remarksInputs = getQualRemarksInputs();
    for (var r = 0; r < REMARKS_FIELD_MAP.length && r < remarksInputs.length; r++) {
      if (remarksInputs[r]) {
        var rVal = remarksInputs[r].value.trim();
        var rStyle = { bold: true, color: rVal ? COLOR_REMARKS : undefined };
        setTextSafe(REMARKS_FIELD_MAP[r], rVal, rStyle);
      }
    }

    var furtherRemarksEl = getFurtherRemarksTextarea();
    var furtherRemarksVal = furtherRemarksEl ? furtherRemarksEl.value.trim() : '';
    setTextSafe('txt_furtherremarks', furtherRemarksVal, { bold: true, color: furtherRemarksVal ? COLOR_REMARKS : undefined });

    var examRows = getExaminerRows();
    var ex1NameInput = examRows.ex1 ? examRows.ex1.querySelector('input[type="text"]') : null;
    var ex1DateInput = examRows.ex1 ? examRows.ex1.querySelector('.date-display') : null;
    var ex1SigImg = examRows.ex1 ? examRows.ex1.querySelector('img[id^="sig-img-"]') : null;
    var ex2NameInput = examRows.ex2 ? examRows.ex2.querySelector('input[type="text"]') : null;
    var ex2DateInput = examRows.ex2 ? examRows.ex2.querySelector('.date-display') : null;
    var ex2SigImg = examRows.ex2 ? examRows.ex2.querySelector('img[id^="sig-img-"]') : null;

    setTextSafe('txtinterviewer1', ex1NameInput ? ex1NameInput.value.trim() : '', { bold: true });
    setTextSafe('txtinterviewer1signdate', ex1DateInput ? ex1DateInput.value.trim() : '', { bold: true });
    setTextSafe('txtinterviewer2', ex2NameInput ? ex2NameInput.value.trim() : '', { bold: true });
    setTextSafe('txtinterviewer2signdate', ex2DateInput ? ex2DateInput.value.trim() : '', { bold: true });

    await setSigSafe('img_sig1', ex1SigImg);
    await setSigSafe('img_sig2', ex2SigImg);

    // Apply blanket read-only lock to all fields except the DQC signature/approval fields
    lockAllFieldsExcept(form, DQC_EDITABLE_FIELD_NAMES);

    var pdfBytes = await pdfDoc.save();
    var blob = new Blob([pdfBytes], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);

    var identityInput = profileInputs[5];
    var iqama = (identityInput && identityInput.value.trim()) ? identityInput.value.trim().replace(/[^a-zA-Z0-9]/g, '') : 'UNKNOWN';
    var companyNameInput = profileInputs[1];
    var companyId = getCompanyId(companyNameInput ? companyNameInput.value : '');
    var dateStamp = formatDdMmmYy(new Date());
    var filename = 'intres_' + companyId + '_' + iqama + '_' + dateStamp + '.pdf';

    if (isIOS()) {
      window.open(url, '_blank');
      alert('Your form "' + filename + '" opened in a new tab.\n\n' +
            'To save it: tap the Share icon (square with an arrow pointing up) at the top of the screen, then choose "Save to Files" and pick a location.\n\n' +
            'This file is ready to be sent to the Divisional Qualification Coordinator for his digital signature.');
    } else {
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      alert('The Pre-Qualification form was generated successfully.\n\nFile: ' + filename +
            '\n(saved to your browser\'s default Downloads folder)\n\n' +
            'This file is ready to be sent to the Divisional Qualification Coordinator for his digital signature.');
    }

    setTimeout(function() { URL.revokeObjectURL(url); }, 30000);
  } catch (err) {
    templatePdfBytesCache = null;
    alert('Could not generate the PDF file.\n\n' + err.message);
  } finally {
    if (printBtn) {
      printBtn.disabled = false;
      printBtn.textContent = printBtnOriginalText || 'Print Form';
    }
  }
}

/* ====== Reset / Clear Form ====== */
function clearAllFieldsToDefault() {
  getEngineerProfileInputs().forEach(function(inp) {
    inp.value = '';
    if (inp.classList.contains('auto-resize-field')) autoResizeField(inp);
  });

  document.querySelectorAll('.qual-table select').forEach(function(sel) {
    if (!sel.disabled) sel.selectedIndex = 0;
  });
  getQualRemarksInputs().forEach(function(inp) { if (inp) inp.value = ''; });
  var furtherRemarksEl = getFurtherRemarksTextarea();
  if (furtherRemarksEl) furtherRemarksEl.value = '';

  var examRows = getExaminerRows();
  ['ex1', 'ex2'].forEach(function(key) {
    var row = examRows[key];
    if (!row) return;
    var nameInput = row.querySelector('input[type="text"]');
    var dateDisplay = row.querySelector('.date-display');
    var datePicker = row.querySelector('.date-hidden-picker');
    if (nameInput) nameInput.value = '';
    if (dateDisplay) dateDisplay.value = '';
    if (datePicker) datePicker.value = '';
  });
  clearSig('ex1');
  clearSig('ex2');

  resetUploadMode();
  lockEntireForm();
  if (typeof scheduleScalePageForMobile === 'function') scheduleScalePageForMobile();
}

function resetFormClick() {
  var ok = confirm('Are you sure you want to reset/clear the form?\n\nAll entered data will be permanently lost and cannot be undone.');
  if (!ok) return;
  clearAllFieldsToDefault();
  clearSavedFormState();
}

/* ====== Persist Form State Across Refreshes ====== */
var FORM_STORAGE_KEY = 'prequalForm_TP-NG-6450-010-003_state';

var storageAvailable = (function() {
  try {
    var testKey = '__prequal_storage_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
})();

function serializeFormState() {
  var state = { profile: [], quals: [], remarks: [], furtherRemarks: '', examiners: {} };
  state.profile = getEngineerProfileInputs().map(function(inp) { return inp.value; });
  document.querySelectorAll('.qual-table tbody select').forEach(function(sel) { state.quals.push(sel.value); });
  state.remarks = getQualRemarksInputs().map(function(inp) { return inp ? inp.value : ''; });
  var furtherRemarksEl = getFurtherRemarksTextarea();
  state.furtherRemarks = furtherRemarksEl ? furtherRemarksEl.value : '';

  var examRows = getExaminerRows();
  ['ex1', 'ex2'].forEach(function(key) {
    var row = examRows[key];
    if (!row) return;
    var nameInput = row.querySelector('input[type="text"]');
    var dateDisplay = row.querySelector('.date-display');
    var datePicker = row.querySelector('.date-hidden-picker');
    var sigImg = document.getElementById('sig-img-' + key);
    state.examiners[key] = {
      name: nameInput ? nameInput.value : '',
      date: dateDisplay ? dateDisplay.value : '',
      dateRaw: datePicker ? datePicker.value : '',
      sig: (sigImg && sigImg.src && sigImg.src.indexOf('data:') === 0) ? sigImg.src : ''
    };
  });
  return state;
}

var saveFormStateTimer = null;
function saveFormState() {
  if (!storageAvailable) return;
  if (saveFormStateTimer) clearTimeout(saveFormStateTimer);
  saveFormStateTimer = setTimeout(function() {
    try { localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(serializeFormState())); } catch (e) { }
  }, 400);
}

function clearSavedFormState() {
  if (!storageAvailable) return;
  try { localStorage.removeItem(FORM_STORAGE_KEY); } catch (e) { }
}

function hasMeaningfulState(state) {
  if (!state) return false;
  var hasProfile = (state.profile || []).some(function(v) { return v && v.trim(); });
  var hasQuals = (state.quals || []).some(function(v) { return v && v !== 'NO'; });
  var hasRemarks = (state.remarks || []).some(function(v) { return v && v.trim(); });
  var hasFurther = state.furtherRemarks && state.furtherRemarks.trim();
  var hasExaminers = Object.keys(state.examiners || {}).some(function(k) {
    var e = state.examiners[k];
    return e && (e.name || e.date || e.sig);
  });
  return hasProfile || hasQuals || hasRemarks || hasFurther || hasExaminers;
}

function restoreFormState(state) {
  var profileInputs = getEngineerProfileInputs();
  (state.profile || []).forEach(function(val, idx) {
    if (profileInputs[idx]) {
      profileInputs[idx].value = val || '';
      if (profileInputs[idx].classList.contains('auto-resize-field')) autoResizeField(profileInputs[idx]);
    }
  });

  var quals = document.querySelectorAll('.qual-table tbody select');
  (state.quals || []).forEach(function(val, idx) { if (quals[idx] && val) quals[idx].value = val; });

  var remarksInputs = getQualRemarksInputs();
  (state.remarks || []).forEach(function(val, idx) { if (remarksInputs[idx]) remarksInputs[idx].value = val || ''; });

  var furtherRemarksEl = getFurtherRemarksTextarea();
  if (furtherRemarksEl) furtherRemarksEl.value = state.furtherRemarks || '';

  var examRows = getExaminerRows();
  ['ex1', 'ex2'].forEach(function(key) {
    var row = examRows[key];
    var e = (state.examiners || {})[key];
    if (!row || !e) return;
    var nameInput = row.querySelector('input[type="text"]');
    var dateDisplay = row.querySelector('.date-display');
    var datePicker = row.querySelector('.date-hidden-picker');
    if (nameInput) nameInput.value = e.name || '';
    if (dateDisplay) dateDisplay.value = e.date || '';
    if (datePicker) datePicker.value = e.dateRaw || '';
    if (e.sig) {
      var img = document.getElementById('sig-img-' + key);
      if (img) { img.src = e.sig; img.style.display = 'block'; }
    }
  });
}

function initFormPersistence() {
  lockEntireForm();
  
  if (!storageAvailable) return;

  var saved = null;
  try {
    var raw = localStorage.getItem(FORM_STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; }

  if (saved && hasMeaningfulState(saved)) {
    var wantsReset = confirm('You have data saved from a previous session (e.g. from before this page was refreshed).\n\nClick OK to RESET/CLEAR the form and start fresh.\nClick Cancel to KEEP your previous data.');
    if (wantsReset) {
      clearSavedFormState();
    } else {
      resetUploadMode();
      restoreFormState(saved);
    }
  }

  document.addEventListener('input', saveFormState);
  document.addEventListener('change', saveFormState);
}

window.addEventListener('load', initFormPersistence);
