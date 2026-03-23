// ══════════════════════════════════════════════════════
//  CPR 節奏訓練遊戲 — GAS 後端
//  部署方式：執行身分「我」，存取對象「所有人」
// ══════════════════════════════════════════════════════

const SPREADSHEET_ID = '1aB3z7xke9KmiVFJ0zcD2TPLjGAT9HGcLSUh4H5a2QkM';
const SCORE_SHEET_NAME = 'CPR_成績';
const TARGET_BPM = 110;

// 班級對應試算表分頁名稱
const CLASSES = ['301', '302', '303', '304', '310', '311', '312'];

// ──────────────── 進入點 ────────────────

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === 'checkStudent') return handleCheckStudent(data);
    if (action === 'submitScore')  return handleSubmitScore(data);

    return makeResponse({ ok: false, error: '未知的操作' });
  } catch (err) {
    return makeResponse({ ok: false, error: err.message });
  }
}

function doGet(e) {
  return makeResponse({ ok: true, status: 'CPR Game API 運作中' });
}

// ──────────────── 學生驗證 ────────────────

function handleCheckStudent(data) {
  const { class_name, seat_no, student_name } = data;

  if (!CLASSES.includes(String(class_name))) {
    return makeResponse({ ok: false, error: '找不到此班級' });
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(String(class_name));
  if (!sheet) return makeResponse({ ok: false, error: '班級資料不存在' });

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0].map(h => String(h).trim());
  const seatIdx = headers.indexOf('座號');
  const nameIdx = headers.indexOf('姓名');

  if (seatIdx < 0 || nameIdx < 0) {
    return makeResponse({ ok: false, error: '名單格式錯誤，請聯絡老師' });
  }

  const found = rows.slice(1).some(row =>
    parseInt(row[seatIdx]) === parseInt(seat_no) &&
    String(row[nameIdx]).trim() === String(student_name).trim()
  );

  if (!found) {
    return makeResponse({ ok: false, error: '找不到此學生，請確認班級、座號和姓名' });
  }

  const history = getStudentHistory(String(class_name), parseInt(seat_no), String(student_name));
  return makeResponse({ ok: true, history });
}

// ──────────────── 成績送出 ────────────────

function handleSubmitScore(data) {
  const { class_name, seat_no, student_name, avg_bpm, accuracy, total_hits, song_title } = data;

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let scoreSheet = ss.getSheetByName(SCORE_SHEET_NAME);

  // 第一次使用時自動建立分頁
  if (!scoreSheet) {
    scoreSheet = ss.insertSheet(SCORE_SHEET_NAME);
    scoreSheet.appendRow(['班級', '座號', '姓名', '平均BPM', '準確率', '總點擊數', '歌曲', '時間']);
    scoreSheet.setFrozenRows(1);
  }

  const playedAt = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');

  scoreSheet.appendRow([
    String(class_name),
    parseInt(seat_no),
    String(student_name),
    avg_bpm   != null ? parseFloat(avg_bpm)   : '',
    accuracy  != null ? parseFloat(accuracy)  : '',
    total_hits != null ? parseInt(total_hits) : 0,
    String(song_title || ''),
    playedAt
  ]);

  const ranking = calculateRanking(scoreSheet, String(class_name), parseInt(seat_no));
  const history = getStudentHistory(String(class_name), parseInt(seat_no), String(student_name));

  return makeResponse({ ok: true, ranking, history });
}

// ──────────────── 歷史成績 ────────────────

function getStudentHistory(className, seatNo, studentName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const scoreSheet = ss.getSheetByName(SCORE_SHEET_NAME);
  if (!scoreSheet) return [];

  return scoreSheet.getDataRange().getValues().slice(1)
    .filter(r => String(r[0]) === className && parseInt(r[1]) === seatNo && String(r[2]) === studentName)
    .map(r => ({
      avg_bpm:    r[3] !== '' ? r[3] : null,
      accuracy:   r[4] !== '' ? r[4] : null,
      total_hits: r[5],
      song_title: r[6],
      played_at:  r[7]
    }))
    .reverse(); // 最新在前
}

// ──────────────── 排名計算 ────────────────

function calculateRanking(scoreSheet, className, seatNo) {
  const rows = scoreSheet.getDataRange().getValues().slice(1);

  // 每位學生取最高準確率的那筆
  const bestMap = {};
  rows.forEach(r => {
    const key = `${r[0]}-${r[1]}`;
    const acc = parseFloat(r[4]) || 0;
    const bpm = parseFloat(r[3]) || 0;
    if (!bestMap[key] || acc > bestMap[key].acc) {
      bestMap[key] = { class_name: String(r[0]), seat_no: parseInt(r[1]), acc, bpm };
    }
  });

  const all = Object.values(bestMap).sort((a, b) => {
    if (b.acc !== a.acc) return b.acc - a.acc;
    return Math.abs(a.bpm - TARGET_BPM) - Math.abs(b.bpm - TARGET_BPM);
  });

  const myKey = `${className}-${seatNo}`;
  let overall = null;
  for (let i = 0; i < all.length; i++) {
    if (`${all[i].class_name}-${all[i].seat_no}` === myKey) { overall = i + 1; break; }
  }

  const classStudents = all.filter(s => s.class_name === className);
  let classRank = null;
  for (let i = 0; i < classStudents.length; i++) {
    if (classStudents[i].seat_no === seatNo) { classRank = i + 1; break; }
  }

  return {
    overall,
    overall_total: all.length,
    class_rank:    classRank,
    class_total:   classStudents.length
  };
}

// ──────────────── 工具函式 ────────────────

function makeResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
