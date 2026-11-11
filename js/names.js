// Türkçe arayüzde yabancı dilde görünen adlar için ortak kural (uygulama ve veri betikleri kullanır).
// OSM "name" etiketi çoğunlukla Türkçedir; ancak bazı kayıtlarda İngilizce ("Cathedral of Ani") ya da
// başka bir yazı sistemiyle (Ermenice, Yunanca, Arapça, Kiril…) girilmiştir. Bu durumda Türkçe kaynak
// (OSM name:tr, yoksa Wikidata Türkçe etiketi) varsa o kullanılır; yoksa ad olduğu gibi kalır (uydurulmaz).

// Latin dışı yazılar: Yunanca, Kiril, Ermenice, İbranice, Arapça, Süryanice, Gürcüce
const NON_LATIN = /[Ͱ-ϿЀ-ӿ԰-֏֐-׿؀-ۿ܀-ݏႠ-ჿ]/;
// İngilizce yer adı sözcükleri (Türkçede de kullanılan "Park", "Otel" gibi sözcükler bilerek dışarıda)
const ENGLISH = /\b(Church|Cathedral|Chapel|Mosque|Castle|Fortress|Citadel|Bridge|Museum|Monastery|Tomb|Mausoleum|Gate|Lake|Mount|Mountain|Palace|Valley|Temple|Ancient|City|Tower|Hill|Theatre|Theater|Square|Street|Cave|Waterfall|Falls|Beach|Island|Bay|Fountain|Bath|Baths|Market|Bazaar|House|Library|Cemetery|Ruins|Saint|Old|Great|Holy|Station|Hospital|School|Spring|Springs|Canyon|Gorge|Aqueduct|Wall|Walls|Harbour|Harbor|Lighthouse)\b|\bof the\b/;

export const looksForeign = (s) => !!s && (NON_LATIN.test(s) || ENGLISH.test(s));

// Türkçe görünen ad: name:tr > (Türkçe görünüyorsa) name > Wikidata Türkçe etiketi > name
export function trName(p, w) {
  if (p["name:tr"]) return p["name:tr"];
  const tr = w?.label?.tr;
  if (p.name && looksForeign(p.name) && tr && !looksForeign(tr)) return tr;
  return p.name || tr || null;
}

// Metnin Türkçe olup olmadığına dair kaba tahmin (web sitesi açıklamaları dili belirtilmeden gelir)
const TR_WORDS = /\b(ve|bir|bu|ile|için|olan|olarak|da|de|en|çok|daha|gibi|yer|alan|tarihi|bulunan|yapılan)\b/gi;
const EN_WORDS = /\b(the|and|of|is|in|to|with|for|was|are|by|on|located|built|from)\b/gi;
export function isTurkishText(s) {
  if (!s) return false;
  const tr = (s.match(TR_WORDS) || []).length + (/[çğışöüİ]/.test(s) ? 2 : 0);
  const en = (s.match(EN_WORDS) || []).length;
  return tr > en;
}
