// Lejant (legend) kategorileri.
// Bu dosya hem tarayıcıda (uygulama) hem Node'da (veri indirme betiği) kullanılır.
//
// osm:   Overpass API seçicileri. Her biri il sınırı içinde aranır.
// icon:  icons/maki/<icon>.svg  (Maki ikon seti, CC0)
// near:  yalnızca turistik alanlara bu kadar metre yakın olanları tut
// names: arayüzde görünen adlar (tr varsayılan)

export const LANGS = ["tr", "en", "de", "fr", "es", "ru"];

export const GROUPS = [
  { id: "yerlesim", color: "#6b4fa0", names: { tr: "Yerleşim ve sınırlar", en: "Settlements & borders", de: "Siedlungen & Grenzen", fr: "Localités et limites", es: "Asentamientos y límites", ru: "Населённые пункты и границы" } },
  { id: "tarih", color: "#a4502a", names: { tr: "Tarih ve kültür", en: "History & culture", de: "Geschichte & Kultur", fr: "Histoire et culture", es: "Historia y cultura", ru: "История и культура" } },
  { id: "inanc", color: "#1f7a6d", names: { tr: "İnanç yapıları", en: "Places of worship", de: "Gotteshäuser", fr: "Lieux de culte", es: "Lugares de culto", ru: "Культовые сооружения" } },
  { id: "doga", color: "#2f7d32", names: { tr: "Doğa ve yer şekilleri", en: "Nature & landforms", de: "Natur & Landschaft", fr: "Nature et relief", es: "Naturaleza y relieve", ru: "Природа и рельеф" } },
  { id: "ulasim", color: "#2a62b0", names: { tr: "Ulaşım", en: "Transport", de: "Verkehr", fr: "Transports", es: "Transporte", ru: "Транспорт" } },
  { id: "hizmet", color: "#c0392b", names: { tr: "Güvenlik ve hizmetler", en: "Safety & services", de: "Sicherheit & Dienste", fr: "Sécurité et services", es: "Seguridad y servicios", ru: "Безопасность и услуги" } },
  { id: "kaynak", color: "#6d4c41", names: { tr: "Madenler ve kaynaklar", en: "Mines & resources", de: "Bergbau & Ressourcen", fr: "Mines et ressources", es: "Minas y recursos", ru: "Шахты и ресурсы" } },
];

export const CATEGORIES = [
  // ---------- Yerleşim ve sınırlar ----------
  { id: "ilceler", group: "yerlesim", icon: "town-hall", kind: "border",
    osm: ['rel["boundary"="administrative"]["admin_level"="6"]'],
    names: { tr: "İlçe sınırları", en: "District borders", de: "Bezirksgrenzen", fr: "Limites des districts", es: "Límites de distritos", ru: "Границы районов" } },
  { id: "koy_mahalle_sinir", group: "yerlesim", icon: "village", kind: "border",
    osm: ['rel["boundary"="administrative"]["admin_level"="8"]'],
    names: { tr: "Köy ve mahalle sınırları", en: "Village & neighbourhood borders", de: "Dorf- und Viertelgrenzen", fr: "Limites des villages et quartiers", es: "Límites de pueblos y barrios", ru: "Границы сёл и кварталов" } },
  { id: "yerlesimler", group: "yerlesim", icon: "village",
    osm: ['node["place"~"^(city|town|village|hamlet|suburb|neighbourhood|quarter)$"]'],
    names: { tr: "Şehir, kasaba, köy ve mahalleler", en: "Towns, villages & neighbourhoods", de: "Städte, Dörfer & Viertel", fr: "Villes, villages et quartiers", es: "Ciudades, pueblos y barrios", ru: "Города, сёла и кварталы" } },
  { id: "kamu", group: "yerlesim", icon: "town-hall",
    osm: ['nwr["amenity"~"^(townhall|courthouse)$"]', 'nwr["office"="government"]["name"]'],
    names: { tr: "Belediyeler ve kamu kurumları", en: "City halls & public institutions", de: "Rathäuser & Behörden", fr: "Mairies et institutions publiques", es: "Ayuntamientos e instituciones", ru: "Мэрии и госучреждения" } },

  // ---------- Tarih ve kültür ----------
  { id: "turistik", group: "tarih", icon: "attraction",
    osm: ['nwr["tourism"~"^(attraction|viewpoint)$"]'],
    names: { tr: "Turistik alanlar", en: "Tourist sights", de: "Sehenswürdigkeiten", fr: "Sites touristiques", es: "Lugares turísticos", ru: "Достопримечательности" } },
  { id: "antik", group: "tarih", icon: "landmark",
    osm: ['nwr["historic"~"^(archaeological_site|ruins)$"]'],
    names: { tr: "Antik kentler ve ören yerleri", en: "Ancient cities & archaeological sites", de: "Antike Städte & Ausgrabungen", fr: "Cités antiques et sites archéologiques", es: "Ciudades antiguas y yacimientos", ru: "Античные города и раскопки" } },
  { id: "yeralti_sehir", group: "tarih", icon: "entrance-alt1",
    osm: ['nwr["tourism"]["name"~"[Yy]eralt[ıi]|[Yy]er [Aa]lt[ıi]|[Uu]nderground"]',
          'nwr["historic"]["name"~"[Yy]eralt[ıi]|[Yy]er [Aa]lt[ıi]|[Uu]nderground"]'],
    names: { tr: "Yeraltı şehirleri", en: "Underground cities", de: "Unterirdische Städte", fr: "Villes souterraines", es: "Ciudades subterráneas", ru: "Подземные города" } },
  { id: "muzeler", group: "tarih", icon: "museum",
    osm: ['nwr["tourism"="museum"]'],
    names: { tr: "Müzeler", en: "Museums", de: "Museen", fr: "Musées", es: "Museos", ru: "Музеи" } },
  { id: "tarihi_yapilar", group: "tarih", icon: "monument",
    osm: ['nwr["historic"~"^(monument|memorial|building|fountain|city_gate|aqueduct|house|manor|mansion|wayside_shrine)$"]["name"]', 'nwr["place"="square"]'],
    names: { tr: "Tarihi yapılar, meydanlar ve mekânlar", en: "Historic buildings & squares", de: "Historische Bauten & Plätze", fr: "Monuments et places historiques", es: "Edificios y plazas históricas", ru: "Исторические здания и площади" } },
  { id: "kaleler", group: "tarih", icon: "castle",
    osm: ['nwr["historic"~"^(castle|fort|citywalls|tower)$"]'],
    names: { tr: "Kaleler ve hisarlar", en: "Castles & fortresses", de: "Burgen & Festungen", fr: "Châteaux et forteresses", es: "Castillos y fortalezas", ru: "Крепости и замки" } },
  { id: "medrese_han_hamam", group: "tarih", icon: "building-alt1",
    osm: ['nwr["historic"="caravanserai"]', 'nwr["building"="caravanserai"]', 'nwr["amenity"="public_bath"]',
          'nwr["historic"]["name"~"[Kk]ervansaray|[Mm]edrese|[Hh]amam|[Hh]an[ıi]$"]',
          'nwr["tourism"]["name"~"[Kk]ervansaray|[Mm]edrese|[Hh]amam|[Hh]an[ıi]$"]'],
    names: { tr: "Medreseler, hanlar ve hamamlar", en: "Madrasas, inns (hans) & baths", de: "Medresen, Karawansereien & Bäder", fr: "Médersas, caravansérails et hammams", es: "Madrazas, caravasares y baños", ru: "Медресе, караван-сараи и бани" } },
  { id: "turbeler", group: "tarih", icon: "cemetery",
    osm: ['nwr["historic"="tomb"]', 'nwr["building"="tomb"]', 'nwr["tomb"]["name"]'],
    names: { tr: "Türbeler ve kümbetler", en: "Tombs & mausoleums", de: "Grabmäler & Mausoleen", fr: "Tombeaux et mausolées", es: "Tumbas y mausoleos", ru: "Гробницы и мавзолеи" } },
  { id: "tiyatrolar", group: "tarih", icon: "theatre",
    osm: ['nwr["amenity"~"^(theatre|arts_centre)$"]', 'nwr["historic"="theatre"]'],
    names: { tr: "Tiyatrolar ve sahneler", en: "Theatres & stages", de: "Theater & Bühnen", fr: "Théâtres et scènes", es: "Teatros y escenarios", ru: "Театры и сцены" } },

  // ---------- İnanç yapıları ----------
  { id: "camiler", group: "inanc", icon: "religious-muslim",
    osm: ['nwr["amenity"="place_of_worship"]["religion"="muslim"]', 'nwr["building"="mosque"]'],
    names: { tr: "Camiler ve mescitler", en: "Mosques & masjids", de: "Moscheen", fr: "Mosquées", es: "Mezquitas", ru: "Мечети" } },
  { id: "kiliseler", group: "inanc", icon: "religious-christian",
    osm: ['nwr["amenity"="place_of_worship"]["religion"="christian"]', 'nwr["building"~"^(church|chapel|cathedral)$"]',
          'nwr["historic"~"^(church|chapel|monastery)$"]', 'nwr["amenity"="monastery"]'],
    names: { tr: "Kiliseler, şapeller ve manastırlar", en: "Churches, chapels & monasteries", de: "Kirchen, Kapellen & Klöster", fr: "Églises, chapelles et monastères", es: "Iglesias, capillas y monasterios", ru: "Церкви, часовни и монастыри" } },
  { id: "sinagoglar", group: "inanc", icon: "religious-jewish",
    osm: ['nwr["amenity"="place_of_worship"]["religion"="jewish"]', 'nwr["building"="synagogue"]'],
    names: { tr: "Sinagoglar", en: "Synagogues", de: "Synagogen", fr: "Synagogues", es: "Sinagogas", ru: "Синагоги" } },
  { id: "tapinaklar", group: "inanc", icon: "place-of-worship",
    osm: ['nwr["historic"="temple"]', 'nwr["building"="temple"]', 'nwr["amenity"="place_of_worship"]["religion"~"^(buddhist|hindu|pagan|zoroastrian|sikh)$"]'],
    names: { tr: "Tapınaklar", en: "Temples", de: "Tempel", fr: "Temples", es: "Templos", ru: "Храмы" } },

  // ---------- Doğa ----------
  { id: "milli_parklar", group: "doga", icon: "park-alt1",
    osm: ['rel["boundary"~"^(national_park|protected_area)$"]', 'way["boundary"~"^(national_park|protected_area)$"]', 'nwr["leisure"="nature_reserve"]'],
    names: { tr: "Milli parklar ve korunan alanlar", en: "National parks & protected areas", de: "Nationalparks & Schutzgebiete", fr: "Parcs nationaux et zones protégées", es: "Parques nacionales y áreas protegidas", ru: "Нацпарки и охраняемые зоны" } },
  { id: "parklar", group: "doga", icon: "park",
    osm: ['nwr["leisure"~"^(park|garden)$"]["name"]'],
    names: { tr: "Parklar ve bahçeler", en: "Parks & gardens", de: "Parks & Gärten", fr: "Parcs et jardins", es: "Parques y jardines", ru: "Парки и сады" } },
  { id: "vadiler", group: "doga", icon: "natural",
    osm: ['nwr["natural"~"^(valley|gorge|canyon)$"]', 'nwr["natural"]["name"~"[Vv]adisi$"]'],
    names: { tr: "Vadiler", en: "Valleys", de: "Täler", fr: "Vallées", es: "Valles", ru: "Долины" } },
  { id: "daglar", group: "doga", icon: "mountain",
    osm: ['node["natural"~"^(peak|volcano)$"]', 'nwr["natural"~"^(ridge|mountain_range)$"]["name"]'],
    names: { tr: "Dağlar, zirveler ve sıradağlar", en: "Mountains, peaks & ranges", de: "Berge, Gipfel & Gebirge", fr: "Montagnes, sommets et chaînes", es: "Montañas, picos y cordilleras", ru: "Горы, вершины и хребты" } },
  { id: "akarsu_gol", group: "doga", icon: "water",
    osm: ['way["waterway"="river"]', 'rel["waterway"="river"]', 'nwr["natural"="water"]["name"]'],
    names: { tr: "Nehirler ve göller", en: "Rivers & lakes", de: "Flüsse & Seen", fr: "Rivières et lacs", es: "Ríos y lagos", ru: "Реки и озёра" } },
  { id: "barajlar", group: "doga", icon: "dam",
    osm: ['nwr["waterway"="dam"]', 'nwr["man_made"="dam"]', 'nwr["water"="reservoir"]["name"]'],
    names: { tr: "Barajlar ve göletler", en: "Dams & reservoirs", de: "Staudämme", fr: "Barrages", es: "Presas", ru: "Плотины и водохранилища" } },
  { id: "plajlar", group: "doga", icon: "beach",
    osm: ['nwr["natural"="beach"]', 'nwr["leisure"="beach_resort"]'],
    names: { tr: "Plajlar", en: "Beaches", de: "Strände", fr: "Plages", es: "Playas", ru: "Пляжи" } },

  // ---------- Ulaşım ----------
  { id: "rayli", group: "ulasim", icon: "rail",
    osm: ['nwr["railway"~"^(station|halt|tram_stop)$"]', 'way["railway"~"^(rail|light_rail|subway|tram)$"]'],
    names: { tr: "Metro ve raylı sistemler", en: "Metro & rail", de: "U-Bahn & Bahn", fr: "Métro et ferroviaire", es: "Metro y ferrocarril", ru: "Метро и железные дороги" } },
  { id: "toplu_tasima", group: "ulasim", icon: "bus",
    osm: ['nwr["amenity"="bus_station"]', 'nwr["public_transport"="station"]'],
    names: { tr: "Otogarlar ve toplu taşıma", en: "Bus stations & public transport", de: "Busbahnhöfe & ÖPNV", fr: "Gares routières et transports", es: "Estaciones de autobús", ru: "Автовокзалы и транспорт" } },
  { id: "yollar", group: "ulasim", icon: "car",
    osm: ['way["highway"~"^(motorway|trunk|primary|secondary)$"]'],
    names: { tr: "Ana yollar", en: "Main roads", de: "Hauptstraßen", fr: "Routes principales", es: "Carreteras principales", ru: "Основные дороги" } },
  { id: "liman_havalimani", group: "ulasim", icon: "airport",
    osm: ['nwr["aeroway"="aerodrome"]', 'nwr["amenity"="ferry_terminal"]', 'nwr["harbour"="yes"]'],
    names: { tr: "Havalimanları ve limanlar", en: "Airports & ports", de: "Flughäfen & Häfen", fr: "Aéroports et ports", es: "Aeropuertos y puertos", ru: "Аэропорты и порты" } },
  { id: "tuneller", group: "ulasim", icon: "tunnel",
    osm: ['way["tunnel"="yes"]["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]', 'way["tunnel"="yes"]["railway"]', 'nwr["man_made"="tunnel"]'],
    names: { tr: "Tüneller", en: "Tunnels", de: "Tunnel", fr: "Tunnels", es: "Túneles", ru: "Тоннели" } },
  { id: "kopruler", group: "ulasim", icon: "bridge",
    osm: ['nwr["man_made"="bridge"]', 'way["bridge"="yes"]["name"]', 'way["bridge"="yes"]["highway"~"^(motorway|trunk|primary|secondary)$"]'],
    names: { tr: "Köprüler", en: "Bridges", de: "Brücken", fr: "Ponts", es: "Puentes", ru: "Мосты" } },

  // ---------- Güvenlik ve hizmetler ----------
  { id: "saglik", group: "hizmet", icon: "hospital", near: 3000,
    osm: ['nwr["amenity"~"^(hospital|clinic|pharmacy|doctors)$"]', 'nwr["healthcare"="hospital"]'],
    names: { tr: "Sağlık (turistik alanlara yakın)", en: "Health (near tourist areas)", de: "Gesundheit (nahe Sehenswürdigkeiten)", fr: "Santé (près des sites)", es: "Salud (cerca de zonas turísticas)", ru: "Медицина (у достопримечательностей)" } },
  { id: "polis", group: "hizmet", icon: "police",
    osm: ['nwr["amenity"="police"]'],
    names: { tr: "Polis ve jandarma", en: "Police & gendarmerie", de: "Polizei & Gendarmerie", fr: "Police et gendarmerie", es: "Policía y gendarmería", ru: "Полиция и жандармерия" } },
  { id: "elcilikler", group: "hizmet", icon: "embassy",
    osm: ['nwr["office"="diplomatic"]', 'nwr["amenity"="embassy"]'],
    names: { tr: "Büyükelçilik ve konsolosluklar", en: "Embassies & consulates", de: "Botschaften & Konsulate", fr: "Ambassades et consulats", es: "Embajadas y consulados", ru: "Посольства и консульства" } },

  // ---------- Madenler ve kaynaklar ----------
  { id: "madenler", group: "kaynak", icon: "industry",
    osm: ['nwr["landuse"="quarry"]', 'nwr["man_made"~"^(mineshaft|adit)$"]', 'nwr["industrial"="mine"]'],
    names: { tr: "Madenler ve ocaklar", en: "Mines & quarries", de: "Bergwerke & Steinbrüche", fr: "Mines et carrières", es: "Minas y canteras", ru: "Шахты и карьеры" } },
  { id: "kaynaklar", group: "kaynak", icon: "hot-spring",
    osm: ['nwr["natural"~"^(hot_spring|geyser)$"]', 'nwr["natural"="spring"]["name"]', 'nwr["power"="plant"]', 'nwr["man_made"="petroleum_well"]'],
    names: { tr: "Yer altı / yer üstü kaynakları", en: "Underground & surface resources", de: "Unter- & oberirdische Ressourcen", fr: "Ressources souterraines et de surface", es: "Recursos subterráneos y de superficie", ru: "Подземные и наземные ресурсы" } },
];

// Turistik yakınlık hesabında "turistik" sayılan kategoriler
export const TOURIST_CATS = ["turistik", "antik", "yeralti_sehir", "muzeler", "tarihi_yapilar", "kaleler", "medrese_han_hamam", "kiliseler", "vadiler"];
