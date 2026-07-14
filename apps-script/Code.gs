/* ──────────────────────────────────────────────────────────────
   Attendance Check-In — Google Apps Script backend
   ---------------------------------------------------------------
   This runs inside a Google Sheet (Extensions → Apps Script) and
   is deployed as a Web App. No Google Cloud Console project is
   required — deploying an Apps Script Web App only needs a Google
   account.

   The bound Sheet is the database. A tab named "Attendance" is
   created automatically with these columns:

     Timestamp | Name | Organizations | Week

   See README.md for step-by-step deployment instructions.
   ────────────────────────────────────────────────────────────── */

var SHEET_NAME = 'Attendance';
var HEADERS = ['Timestamp', 'Name', 'Organizations', 'Week'];

/* Return (creating if needed) the sheet used as storage. */
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* GET  → returns all check-ins as JSON: { ok, records: [...] } */
function doGet(e) {
  try {
    var sheet = getSheet_();
    var values = sheet.getDataRange().getValues();
    var records = [];
    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      if (!row[0] && !row[1]) continue; // skip blank rows
      records.push({
        timestamp: row[0] instanceof Date ? row[0].toISOString() : String(row[0]),
        name: String(row[1] || ''),
        organizations: String(row[2] || '')
          .split(',')
          .map(function (s) { return s.trim(); })
          .filter(function (s) { return s.length; }),
        week: normalizeWeek_(row[3]),
      });
    }
    return jsonOut_({ ok: true, records: records });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

/* POST → records a check-in. Body is JSON:
   { action:"checkin", name, organizations:[...], week:"YYYY-MM-DD" } */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var name = String(body.name || '').trim();
    var orgs = Array.isArray(body.organizations) ? body.organizations : [];
    var week = String(body.week || '').trim();

    if (!name) return jsonOut_({ ok: false, error: 'Name is required.' });
    if (!orgs.length) return jsonOut_({ ok: false, error: 'At least one organization is required.' });

    var sheet = getSheet_();
    sheet.appendRow([new Date(), name, orgs.join(', '), week]);
    return jsonOut_({ ok: true });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

/* Normalize the Week cell to a YYYY-MM-DD string regardless of
   whether Sheets stored it as text or as a Date. */
function normalizeWeek_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value || '');
}
