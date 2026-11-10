// İl tanımları. Yeni il eklemek için buraya bir kayıt ekleyip
// `node scripts/fetch-data.mjs <il-id>` çalıştırmak yeterli.
export const PROVINCES = {
  nevsehir: {
    id: "nevsehir",
    osmRelation: 154449,          // OpenStreetMap: Nevşehir (admin_level=4)
    wikidata: "Q430693",
    names: { tr: "Nevşehir · Kapadokya", en: "Nevşehir · Cappadocia", de: "Nevşehir · Kappadokien", fr: "Nevşehir · Cappadoce", es: "Nevşehir · Capadocia", ru: "Невшехир · Каппадокия" },
    center: [34.83, 38.64],      // Göreme çevresi
    zoom: 10.2,
    bounds: [[33.6, 37.9], [35.8, 39.8]], // kaydırma sınırı (biraz geniş)
  },
};

export const DEFAULT_PROVINCE = "nevsehir";
