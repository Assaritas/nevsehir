# Rehber Harita

Rehberli turlarda misafirlerle WhatsApp üzerinden paylaşılan, telefona uygulama gibi kurulabilen (PWA) etkileşimli il haritası.
Pilot iller: **Nevşehir / Kapadokya** ve **İstanbul**. Aynı süreç 81 ilin tamamı için uygulanır.

Tamamen ücretsiz araçlar ve açık lisanslı verilerle çalışır; API anahtarı, sunucu veya abonelik gerekmez.

## Özellikler (Aşama 1)

- Android, iOS ve masaüstünde çalışır; "Ana ekrana ekle" ile uygulama gibi açılır, gezilen yerler çevrimdışı da görünür
- Türkçe varsayılan; İngilizce, Almanca, Fransızca, İspanyolca, Rusça
- Açık / koyu / otomatik tema
- Katmanlar: **Arazi** (eş yükselti eğrileri + gölgeli kabartma), **Uydu**, **Yer şekilleri** (yükseklik renklendirmesi), **Bitki örtüsü** (10 m arazi örtüsü)
- 2B / 3B geçişi, yükselti ölçeği kaydırıcısı, irtifa kaydırıcısı, +/− düğmeleri, pusula
- Yakınlaştırmaya göre değişen ölçek çubuğu (metre ve mil)
- 7 grupta 35 kategorilik lejant; **açılışta hiçbiri açık değildir**
- Bilgi kartları: fotoğraf, Vikipedi özeti (kaynak bağlantılı), yol tarifi, arama, web sitesi, Vikipedi, TDV İslâm Ansiklopedisi, Commons fotoğrafları, paylaşma
- Türkçe karakterlere duyarsız arama ("kursunlu" → Kurşunlu Camii), sonuçlarda ilçe bilgisi
- **Bugünkü tur**: rehber modunda durak/saat girip WhatsApp'a bağlantı olarak paylaşma
- **Zaman kaydırıcısı** (MÖ 2000 – bugün): o yıldaki devlet sınırları ve tarihî yer adları (OpenHistoricalMap), yalnızca o yılda
  var olduğu kaynaklarla bilinen yerler; tarihi bilinmeyen lejant öğeleri otomatik gizlenir; kaynaklı olay çizelgesi
- **Diorama**: görünen alan, katmanlı yan duvarları olan döndürülebilir bir 3B maket olarak (uydu / yer şekilleri / bitki örtüsü dokusuyla)
- **Yeraltı katmanı** (diorama içinde): yüzey yarı saydam olur, yeraltı şehirlerinin katları kaynaklı kat/derinlik bilgisiyle,
  bilinmeyenler gri ve "şematik" etiketiyle gösterilir
- Paylaşılan bağlantı doğrudan o yeri açar (ör. `?il=nevsehir&poi=muzeler:w123456`)
- İl dışı karartılır, il sınırı vurgulanır

## Bilgisayarda çalıştırma

```
cd rehber-harita
python -m http.server 8080
```
Tarayıcıda `http://localhost:8080` adresini açın.

## İnternette yayınlama (GitHub Pages, ücretsiz)

1. https://github.com adresinde ücretsiz hesap açın.
2. Sağ üstte **+ → New repository**: ad `rehber-harita`, **Public** seçin, oluşturun.
3. Bu klasörde:
   ```
   git remote add origin https://github.com/<kullanıcı-adınız>/rehber-harita.git
   git push -u origin main
   ```
4. GitHub'da depo → **Settings → Pages → Branch: main / (root) → Save**.
5. Birkaç dakika sonra harita `https://<kullanıcı-adınız>.github.io/rehber-harita/` adresinde yayında olur.
   Bu bağlantıyı WhatsApp grubunda paylaşabilirsiniz.

## Verileri güncelleme / yeni il ekleme

```
cd scripts
npm install
node fetch-data.mjs nevsehir        # OpenStreetMap + Wikidata noktaları
node build-landcover.mjs nevsehir   # ESA WorldCover bitki örtüsü karoları
```

Yeni il eklemek için `config/provinces.js` dosyasına ilin OpenStreetMap ilişki numarasını ve merkezini ekleyip aynı komutu il kimliğiyle çalıştırın.

## Hatalı bağlantıları düzeltme

OpenStreetMap'te bazı yerler yanlış Wikidata / Vikipedi öğesine bağlı olabilir. Veri betiği liste ve anlam ayrımı
sayfalarını otomatik eler; geri kalan hatalar `data/<il>/overrides.json` ile düzeltilir ve veri yenilendiğinde korunur:

```json
{ "w26045752": { "wikidata": "Q115453100", "wikipedia": null } }
```

## Bugünkü tur (rehber modu)

1. Haritayı `…/?rehber=1` adresiyle bir kez açın (rehber modu cihazınızda hatırlanır; `?rehber=0` ile kapanır).
2. **Tur** düğmesinden tur adını ve tarihini girin. Durakları **Haritadan durak ekle** ile ya da bir yerin kartındaki
   **Tura ekle** düğmesiyle ekleyin; saat ve not yazın, ok düğmeleriyle sıralayın.
3. **Bağlantıyı paylaş** → WhatsApp: duraklar saatleriyle birlikte metin olarak, harita bağlantısıyla gider.
4. Misafir bağlantıyı açınca tur haritada numaralı duraklarla görünür, sıradaki durak vurgulanır, her durak için yol tarifi vardır.
   Tur misafirin cihazında saklanır; ana ekrandan açtığında da görünür.

Tur bilgisi bağlantının içindedir; sunucu ya da hesap gerekmez.

## Tarih ve yeraltı verileri

- `data/<il>/history.json` — yerlerin kaynaklı tarihleri (`from`/`to`, MÖ için eksi yıl), zamansız kategoriler (dağ, vadi, nehir)
  ve zaman çizelgesindeki olaylar. Burada olmayan yerler için Wikidata "kuruluş" (P571) ve OSM `start_date` kullanılır;
  yerleşim ve idari sınırlar için Wikidata kuruluş tarihi kullanılmaz (ilçenin kuruluşu yerleşimin yaşı değildir).
- `data/<il>/underground.json` — yeraltı şehirleri: kat sayısı, derinlik (m), gezilebilir kısım ve kaynaklar.
  Bilinmeyen değer `null` bırakılır; diorama bunu "şematik" olarak çizer.
- Sınırlar: [OpenHistoricalMap](https://www.openhistoricalmap.org) (CC0, gönüllü katkı; bazı dönemler eksik — ör. Selçuklu dönemi bu bölgede kayıtlı değil).

## Rehber onaylı içerik

`data/<il>/curated.json` dosyasındaki metinler kartta Vikipedi özetinin yerine gösterilir.
Metinler kaynaklıdır ve herkese **"Kaynaklı açıklama"** etiketiyle, kaynak listesiyle birlikte görünür.

```json
{
  "Q1234567": {
    "ids": ["n123", "w456"],
    "text": { "tr": "Türkçe açıklama…

İkinci paragraf…", "en": "English description…" },
    "sources": [{ "title": "TDV İslâm Ansiklopedisi – …", "url": "https://islamansiklopedisi.org.tr/…" }]
  }
}
```
Anahtar Wikidata numarası (`Q…`) ya da OSM kimliği (`n…`, `w…`, `r…`) olabilir.

## Veri kaynakları ve lisanslar

| Veri | Kaynak | Lisans |
|---|---|---|
| Noktalar, sınırlar, yollar | OpenStreetMap katkıcıları | ODbL |
| Çok dilli adlar, görseller, web siteleri | Wikidata | CC0 |
| Özet metinler | Vikipedi | CC BY-SA 4.0 |
| Fotoğraflar | Wikimedia Commons | dosyaya göre |
| Temel harita | OpenFreeMap / OpenMapTiles | ücretsiz, ticari kullanım serbest |
| Yükseklik (3B, kabartma, eş yükselti) | AWS Terrain Tiles (Mapzen; SRTM, GMTED, ETOPO1) | açık veri |
| Uydu görüntüsü | EOX Sentinel-2 cloudless 2024 | **CC BY-NC-SA 4.0 (ticari olmayan)** |
| Bitki örtüsü / arazi örtüsü | ESA WorldCover 2021, 10 m | CC BY 4.0 |
| Tarihî sınırlar ve yer adları | OpenHistoricalMap | CC0 |
| İkonlar | Mapbox Maki | CC0 |
| 3B diorama motoru | three.js | MIT |
| Harita motoru | MapLibre GL JS, maplibre-contour | BSD-3 |

> **Not:** Uydu katmanı ticari olmayan kullanım lisanslıdır. Ücretli turlarda kullanım ticari sayılabilir; gerekirse bu katman ticari kullanıma izin veren bir kaynakla değiştirilmelidir.

## Yeni il ekleme (81 il için aynı süreç)

1. `config/provinces.js` dosyasına il kaydı (OSM ilişki numarası, merkez, sınır kutusu).
2. Veriler:
   ```
   cd scripts
   node fetch-data.mjs <il>         # OSM + Wikidata (sunucu hatasında kategori atlanır; yeniden çalıştırınca tamamlanır)
   node build-landcover.mjs <il>    # ESA WorldCover bitki örtüsü
   node build-monuments.mjs <il>    # OSM building:part → 3B anıt modelleri (kubbe, minare, külah)
   ```
3. Araştırma: `data/<il>/content-src.json` — kaynaklı açıklamalar, tarihler, olaylar ve yeraltı verileri (ad kalıbıyla).
   `node resolve-content.mjs <il>` bunları harita kayıtlarına bağlar; ardından `node fetch-data.mjs <il>` (önbellekten, hızlı) tarihleri işler.

## Arayüz notları

- Sağdaki menü gruplu (Keşfet / Harita / Ayarlar) ve açılır-kapanır; telefonda kapalı başlar.
- Telefonda yakınlaştırma çubuğu yalnızca yakınlaştırırken görünür.
- Temel haritadaki adlı simgelere (cami, eczane, köy adı…) dokununca bilgi kartı açılır; lejant verisinde aynı yer varsa tam kart gösterilir.
- Katmanlar: **Sade** (Google Haritalar'a benzer), Arazi, Uydu, Yer şekilleri, Bitki örtüsü; seçenekler: **3B binalar**, **3B anıt modelleri**.
- Tur programı birden çok gün içerebilir (her günün rengi ve sekmesi ayrı); tur ekranı açıkken haritada yalnızca o günün durakları görünür.

## Yol haritası

- **Aşama 2 (tamamlandı):** arama, "Bugünkü tur" katmanı ve rehber modu, kaynaklı taslak metinler (10 yer), veri düzeltmeleri
- **Aşama 3 (tamamlandı):** diorama, yeraltı katmanı, tarihsel zaman kaydırıcısı
- **Aşama 4 (sürüyor):** İstanbul pilotu, il seçici, 3B binalar ve anıtlar, sade katman, çok günlü tur, yeni lejant öğeleri; ardından kalan iller
