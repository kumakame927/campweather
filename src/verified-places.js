// Nominatim に施設名の一致がない場合の補足候補。推測の座標は使用しない。
// 2026-10-31: なっぷの Campground JSON-LD（name/address/geo）を確認。
export const VERIFIED_PLACES = [{
  name: '亀山湖オートキャンプ場',
  location: {
    latitude: 35.215901, longitude: 140.106592, address: '千葉県君津市折木沢湯の川1306',
    source: 'verified-listing', sourceId: 'nap-camp-11955', sourceName: 'なっぷ（公開施設情報・2026-10-31確認）',
    sourceUrl: 'https://www.nap-camp.com/chiba/11955',
  },
}];
