// HTML から CSS を読み込むことで、Vite を通さない静的プレビューでも起動する。
import('./main.js').catch(error => {
  console.error('Camp Weather の起動に失敗しました。', error);
  const message = document.querySelector('#startup-error');
  message.hidden = false;
  message.textContent = 'アプリを起動できませんでした。ページを再読み込みしてください。改善しない場合は、プレビューのJavaScriptファイルが正しく配信されているか確認してください。';
  document.querySelector('#fetch-status').textContent = '起動に失敗しました。';
});
