// =============================================================
// PicSearch — Google Apps Script
// Paste this entire file into https://script.google.com
// Then deploy as a Web App (see SETUP.md for instructions).
// =============================================================

var SHEET_ID   = 'YOUR_GOOGLE_SHEET_ID_HERE'; // same value as in config.js
var SHEET_NAME = 'Vehicles';
var HEADERS    = ['S/N','Vehicle Make','Model','Year','Capacity','Luggage','Type','Aff. Price','Ret. Price','Pics'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(HEADERS);
    }

    var vehicles = JSON.parse(e.postData.contents);
    if (!Array.isArray(vehicles)) vehicles = [vehicles];

    vehicles.forEach(function(v) {
      sheet.appendRow([
        v.sn          || '',
        v.vehiclemake || '',
        v.model       || '',
        v.year        || '',
        v.capacity    || '',
        v.luggage     || '',
        v.type        || '',
        v.affprice    || '',
        v.retprice    || '',
        v.pics        || '',
      ]);
    });

    lock.releaseLock();

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, count: vehicles.length }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    if (lock.hasLock()) lock.releaseLock();
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', service: 'PicSearch' }))
    .setMimeType(ContentService.MimeType.JSON);
}