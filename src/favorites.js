export function initFavorites({ getState, setFavorite, setCompared, forget, locationDetails }) {
  const $ = selector => document.querySelector(selector), dialog = $('#favorites-dialog');
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let deletion = null;
  function render() {
    const { camps, favoriteIds, comparisonIds } = getState();
    const favorites = new Set(favoriteIds), comparing = new Set(comparisonIds);
    $('#favorites-count').textContent = String(favoriteIds.length);
    const rows = records => records.sort((a, b) => a.name.localeCompare(b.name, 'ja')).map(camp => `<article class="favorite-row" data-library-id="${escape(camp.id)}"><h3>${escape(camp.name)}</h3><p class="address">${escape(camp.location.address)}</p><div class="favorite-actions"><button class="button secondary" data-compare="${escape(camp.id)}" type="button"${comparing.has(camp.id) ? ' disabled' : ''}>${comparing.has(camp.id) ? '比較中' : '比較に追加'}</button><button class="button secondary" data-library-favorite="${escape(camp.id)}" type="button" aria-pressed="${favorites.has(camp.id)}">${favorites.has(camp.id) ? '★ お気に入り解除' : '☆ お気に入り登録'}</button><button class="text-button delete-button" data-forget="${escape(camp.id)}" type="button" aria-label="${escape(camp.name)}を完全削除">完全削除</button></div></article>`).join('');
    $('#favorites-list').innerHTML = rows(camps.filter(camp => favorites.has(camp.id)));
    $('#favorites-empty').hidden = favoriteIds.length > 0;
    const others = camps.filter(camp => !favorites.has(camp.id));
    $('#other-camps').hidden = !others.length; $('#other-count').textContent = String(others.length);
    $('#other-list').innerHTML = rows(others);
  }
  const open = () => { render(); $('#favorites-status').textContent = ''; dialog.showModal(); $('#close-favorites').focus(); };
  $('#open-favorites').addEventListener('click', open); $('#empty-open-favorites').addEventListener('click', open);
  $('#close-favorites').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => $('#open-favorites').focus());
  dialog.addEventListener('click', event => {
    const add = event.target.closest('[data-compare]');
    if (add && setCompared(add.dataset.compare, true)) { $('#favorites-status').textContent = '天気比較に追加しました。'; render(); }
    const favorite = event.target.closest('[data-library-favorite]');
    if (favorite) {
      const id = favorite.dataset.libraryFavorite, enabled = !getState().favoriteIds.includes(id);
      if (setFavorite(id, enabled)) { $('#favorites-status').textContent = enabled ? 'お気に入りに登録しました。比較状態は変わりません。' : 'お気に入りを解除しました。比較状態は変わりません。'; render(); }
    }
    const remove = event.target.closest('[data-forget]');
    if (remove) {
      deletion = remove.dataset.forget;
      $('#delete-name').textContent = getState().camps.find(camp => camp.id === deletion)?.name ?? '';
      $('#delete-dialog').showModal(); $('#cancel-delete').focus();
    }
  });
  $('#cancel-delete').addEventListener('click', () => $('#delete-dialog').close());
  $('#confirm-delete').addEventListener('click', () => { if (deletion && forget(deletion)) { $('#delete-dialog').close(); render(); $('#favorites-status').textContent = '登録情報を完全に削除しました。'; } });
  $('#delete-dialog').addEventListener('close', () => { deletion = null; $('#close-favorites').focus(); });
  $('#favorites-add-new').addEventListener('click', () => { dialog.close(); $('#add-camp').click(); });
  render();
  return { render };
}
