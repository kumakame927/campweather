export function writeStorageEntries(entries, storage = localStorage) {
  let originals;
  try { originals = entries.map(([key]) => [key, storage.getItem(key)]); }
  catch { throw new Error('端末の保存領域を読み取れません。元のデータは変更していません。'); }
  const written = [];
  try { for (const [key, value] of entries) { storage.setItem(key, value); written.push(key); } }
  catch {
    let failed = false;
    for (const [key, value] of originals.filter(([key]) => written.includes(key)).reverse()) {
      try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { failed = true; }
    }
    throw new Error(failed ? '保存と元データの復元を完了できませんでした。バックアップを保管し、ストレージ設定を確認してください。' : '保存できなかったため、変更を中止しました。元のデータは維持しています。');
  }
}
