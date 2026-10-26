# tefas-js

[Türkçe](README.md) | [English](README.en.md)

TEFAS verilerine erişmek için JavaScript/TypeScript kütüphanesi.

Fonları listeleyip arayabilir; fiyatları, günlük fon verilerini, varlık dağılımını ve getiri karşılaştırmalarını alabilirsiniz. Node.js 22 ve üzeriyle çalışır, ek bağımlılık gerektirmez.

Bu belge `0.2.0` API'sini anlatır. `0.1.1` kullanıyorsanız yeni metotlar için paketi güncelleyin.

## Kurulum

```sh
npm install tefas-js
```

Bun veya pnpm de kullanabilirsiniz:

```sh
bun add tefas-js
pnpm add tefas-js
```

## Kullanım

```ts
import { TefasClient } from "tefas-js";

const client = new TefasClient();
const history = await client.getPriceHistory("TI2", { periodMonths: 12 });

console.log(history.fundName);
console.log(history.prices);
console.log(history.returnedDateRange);
```

`periodMonths`, kaç aylık veri istediğinizi belirtir. `1`, `3`, `6`, `12`, `36` veya `60` olabilir.

Dönemi `period` ile de seçebilirsiniz. Haftalık veri için `1w`, yılbaşından bugüne veri için `ytd` kullanılır:

```ts
const weekly = await client.getPriceHistory("TI2", { period: "1w" });
const ytd = await client.getPriceHistory("TI2", { period: "ytd" });
```

Diğer seçenekler `1m`, `3m`, `6m`, `1y`, `3y` ve `5y`. `period` ile `periodMonths` seçeneklerinden yalnızca birini vermelisiniz. Hiçbiri verilmezse veya ikisi birlikte verilirse `INVALID_ARGUMENT` hatası döner.

Sonuçtaki `period` her zaman seçilen dönemi gösterir. `periodMonths` haftalık ve YTD sorgularında `null`, diğer dönemlerde ay sayısıdır.

Fon kodunda büyük/küçük harf ve baştaki ya da sondaki boşluklar sorun olmaz. Örneğin `" ti2 "`, `"TI2"` olarak işlenir. Kod üç harf veya rakamdan oluşmalıdır.

`prices` içindeki kayıtlar tarihe göre eskiden yeniye sıralanır. Her kayıtta `date` ve `price` bulunur:

```ts
{ date: "2026-10-21", price: 0.117352 }
```

Aynı tarihe ait tekrar eden kayıtlar birleştirilir. Aynı gün için farklı fiyatlar gelirse hata döner. TEFAS boş veri döndürürse `prices` boş bir dizi, `returnedDateRange` ise `null` olur; bu, fonun bulunmadığı anlamına gelmeyebilir.

`returnedDateRange`, gelen verinin ilk ve son tarihini gösterir. İstenen dönemdeki tüm kayıtların geldiğini garanti etmez.

## Fon listesi ve arama

```ts
import { TefasClient, searchFunds } from "tefas-js";

const client = new TefasClient();
const funds = await client.listFunds();
const found = searchFunds(funds, "is");
```

`listFunds`, fon kodu, fon adı, kurucu kodu (`founderCode`) ve kurucu adını (`founderName`) döndürür. Kurucu bilgisi yoksa ilgili alan `null` olur. Liste fon koduna göre sıralanır; tekrar eden aynı kayıtlar birleştirilir, çelişen kayıtlar hata verir.

`searchFunds`, elinizdeki listede arama yapar; yeni istek göndermez ve listeyi değiştirmez. Örnekteki `is` sorgusu `İŞ PORTFÖY` adını da bulur. Önce kodu tam eşleşenler, sonra kodu sorguyla başlayanlar, ardından adında sorgu geçenler gelir. Her grup fon koduna göre sıralanır. Boş sorgu kabul edilmez.

`listFunds({ signal })` ile istek iptal edilebilir. Zaman aşımı ve yeniden deneme ayarları fiyat sorgularıyla aynıdır. TEFAS'ın bu listesiyle günlük fon verisinin kapsamı aynı olmayabilir.

## Günlük fon verileri

```ts
const fund = await client.getSnapshot("TI2", { date: "2026-10-20" });
const snapshots = await client.getSnapshots({ date: "2026-10-20" });
const pension = await client.getSnapshot("AE1", {
  date: "2026-10-20",
  kind: "EMK",
});
```

`getSnapshot` tek fonun, `getSnapshots` ise seçilen türdeki fonların o güne ait verisini getirir. `date` zorunludur ve `YYYY-MM-DD` biçimindedir. `kind` varsayılan olarak `YAT`; diğer seçenekler `EMK`, `BYF`, `GYF` ve `GSYF`.

`kind` fonun türüyle uyuşmazsa (örneğin bir emeklilik fonu `YAT` ile sorgulanırsa) `getSnapshot` hata yerine `null` döner.

Sonuçta fon kodu, ad, tür, tarih ve fiyatın yanında şu alanlar bulunur:

| Alan | Açıklama |
| --- | --- |
| `sharesOutstanding` | Tedavüldeki pay sayısı |
| `investorCount` | Yatırımcı sayısı |
| `portfolioSize` | Portföy büyüklüğü |

Bu üç alanda TEFAS'ın göndermediği değerler `null` olur. `0`, gerçekten sıfır olarak gelen değerdir. Liste fon koduna göre sıralanır ve aynı kayıtlar tekilleştirilir. Çelişen kayıtlar veya istenenden farklı bir tarih hata verir.

Veri yoksa `getSnapshot` için `null`, `getSnapshots` için boş dizi döner. Hafta sonu keşfinde görülen `Index 0 out of bounds for length 0` yanıtı da boş sonuç olarak işlenir. Diğer kaynak hataları bildirilir. Güncel günün verisi henüz yayımlanmamış olabilir. İki metot da `signal` seçeneğini ve istemcinin zaman aşımı/yeniden deneme ayarlarını kullanır.

## Tarih aralığıyla günlük geçmiş

```ts
const history = await client.getDailyHistory("TI2", {
  from: "2026-09-01",
  to: "2026-10-10",
  onProgress: ({ completed, total }) => {
    console.log(`${completed}/${total}`);
  },
});
```

`getDailyHistory`, bir fonun iki tarih arasındaki günlük verisini `getSnapshot` ile aynı alanlarla (`FundSnapshot`) getirir. `from` ve `to` dahildir; aynı tarih tek gün sayılır. Aralık en fazla **1827 takvim günü** olabilir (`to − from + 1`, yaklaşık beş yıl). `kind` varsayılan olarak `YAT`'tır.

Sonuç tarihe göre eskiden yeniye sıralanır. Hafta sonu, tatil veya yayımlanmamış günler için kayıt üretilmez; önceki fiyat taşınmaz, sıfır yazılmaz. Veri yoksa boş dizi döner.

`getPriceHistory`'den farkı: `getPriceHistory`, `1y` gibi sabit bir dönem için yalnızca fiyat serisi döndürür. `getDailyHistory` ise istediğiniz tarih aralığında pay sayısı, yatırımcı sayısı ve portföy büyüklüğünü de verir.

TEFAS'a aralık 28 günlük parçalar halinde sırayla sorulur; istekler paralel gönderilmez. İki gerçek istek denemesinin başlangıcı arasında en az `minIntervalMs` beklenir (varsayılan `10000`, `0`–`60000`). İlk istekten önce bekleme yoktur. Yeniden denemeler de bu aralığa dahildir; yeniden deneme beklemesi sırasında geçen süre aralıktan düşülür. Bu sınır yalnızca o çağrı için geçerlidir; diğer metotları yavaşlatmaz.

Beş yıllık üst sınıra yakın bir aralık yaklaşık **66 istek** gerektirir ve varsayılan hızla yaklaşık **11 dakika** sürebilir. Bu kesin bir süre değildir; yanıt süreleri, yeniden denemeler ve bekleme aralıklarına göre değişir.

İki ayrı süre sınırı vardır:

- Metodun `timeoutMs` seçeneği bütün işlemin toplam süresidir; bekleme aralıkları ve yeniden denemeler dahildir. Varsayılanı `parça sayısı × (minIntervalMs + istemcinin timeoutMs değeri)`. Bu bir başarı garantisi değildir.
- İstemcinin `timeoutMs` ayarı her parça için ayrı uygulanır ve o parçanın yeniden denemelerini de kapsar. Bir parçada yeniden deneme yapılacaksa, istemci zaman aşımının `minIntervalMs`'ten büyük olması gerekir; aksi halde yeniden deneme beklerken parça zaman aşımına uğrar.

İki sınırdan biri aşılırsa `TIMEOUT`, `signal` ile iptal edilirse `ABORTED` hatası döner. Herhangi bir parça kalıcı olarak başarısız olursa metot hata verir; kısmi sonuç döndürülmez ve sonraki parçalar istenmez.

`onProgress` her parça başarıyla işlendiğinde `{ completed, total }` ile çağrılır. `completed` 1'den başlar, `total` parça sayısıdır. Boş parçalar da sayılır; başarısız denemeler sayılmaz. Callback hata fırlatırsa aynı hata dışarı iletilir ve istekler durur.

## Varlık dağılımı

```ts
const allocation = await client.getAllocation("TI2", { date: "2026-10-20" });

console.log(allocation?.weights.stock);
console.log(allocation?.weights.reverseRepo);
```

`getAllocation`, seçilen tarihteki fon dağılımını getirir. `kind` ve `signal` seçenekleri günlük sorgularla aynıdır. Sunucu filtresi kullanılır; her çağrıda tüm fonların dağılımı indirilmez. Boş sonuçta `null` döner.

Hafta sonu kontrolünde doğrulanan `Index 0 out of bounds for length 0` yanıtında da `null` döner; diğer kaynak hataları bildirilir. Yanıttaki `bilFiyat` yüzde olmadığı için dağılıma katılmaz.

`weights` içindeki değerler yüzdedir: `92.28`, `%92,28` anlamına gelir. Eksik veya `null` kalemler nesneye eklenmez, sıfır değerler korunur. Kalemler `0`–`100` arasında olmalı; toplamın 100'den en fazla 0,5 puan sapmasına izin verilir. Çelişen kayıtlar, farklı fon kodu veya farklı tarih hata verir.

## Getiri karşılaştırması

```ts
const comparison = await client.getComparison("TI2", { period: "1y" });

console.log(comparison.fundReturn);
console.log(comparison.benchmarks.bist100);
console.log(comparison.benchmarks.inflation);
```

`getComparison`, fonun seçilen dönemdeki getirisini karşılaştırma ölçütleriyle birlikte getirir. `period`, fiyat geçmişindeki dönemlerle aynıdır: `1w`, `1m`, `3m`, `6m`, `ytd`, `1y`, `3y` veya `5y`.

Getiriler yüzde değil **orandır**: `0.1166`, `%11,66`; `-0.0398`, `-%3,98` anlamına gelir. Fon ve karşılaştırmalar aynı birimi kullanır. Negatif ve sıfır getiriler korunur.

`benchmarks` şu alanları içerebilir: `gold`, `bist100`, `bist30`, `eur`, `usd`, `depositRate` (mevduat faizi), `inflation` (TÜFE) ve `umbrellaCategory`. `umbrellaCategory`, fonun kendi şemsiye kategorisinin ortalamasıdır; örneğin TI2 için Hisse Senedi Şemsiye Fonu. Bu yüzden fondan fona farklı bir kategoriyi temsil eder.

TEFAS her dönem için her karşılaştırmayı döndürmez; örneğin haftalık sorguda mevduat ve enflasyon yoktur. Eksik karşılaştırmalar nesneye eklenmez. Fonun kendi getirisi yoksa `fundReturn` `null` olur. Tanınmayan yeni karşılaştırmalar yok sayılır.

## Fon tipi

```ts
const type = await client.getFundType("AE1");

console.log(type); // "pension"
```

`getFundType`, fonun yatırım fonu (`"investment"`) mi yoksa emeklilik fonu (`"pension"`) mu olduğunu döndürür. Fon bulunamazsa `null` döner. Bu değer, günlük sorgulardaki `kind` seçeneğinden (`YAT`, `EMK` vb.) farklıdır: `kind` sizin seçtiğiniz sorgu kategorisidir, `getFundType` ise TEFAS'ın fon için bildirdiği tiptir.

## Sıralama ve piyasa özeti

```ts
import { topFunds, summarizeMarket } from "tefas-js";

const largest = topFunds(snapshots, { by: "portfolioSize", limit: 10 });
const mostInvestors = topFunds(snapshots, { by: "investorCount", limit: 10 });
const summary = summarizeMarket(snapshots);
```

Bu iki fonksiyon elinizdeki veriyi kullanır, istek göndermez ve girdiyi değiştirmez. `topFunds`, seçilen alanı `null` olan fonları dışarıda bırakır. Değerler büyükten küçüğe, eşitlikte fon koduna göre sıralanır. `limit` pozitif bir tam sayı olmalıdır.

`summarizeMarket`; fon sayısını, portföy büyüklükleri toplamını ve yatırımcı sayıları toplamını döndürür. `null` değerler toplama katılmaz. Yatırımcı toplamı benzersiz kişi sayısı değildir; aynı kişi birden fazla fonda yer alabilir. Veriler farklı türlerden veya tarihlerden geliyorsa özette ilgili `kind` ya da `date` alanı `null` olur. Boş dizide toplamlar sıfırdır.

## Zaman aşımı ve iptal

Varsayılan zaman aşımı 10 saniyedir. İstek, yanıtın okunması ve varsa yeniden denemeler bu süreye dahildir. Süreyi milisaniye olarak değiştirebilirsiniz:

```ts
const client = new TefasClient({ timeoutMs: 15_000 });
```

`timeoutMs`, `1` ile `2_147_483_647` arasında bir tam sayı olmalıdır. Süre dolarsa `TIMEOUT` hatası alırsınız.

İsteği kendiniz iptal etmek için `AbortController` kullanabilirsiniz:

```ts
const controller = new AbortController();
const pending = client.getPriceHistory("TI2", {
  periodMonths: 1,
  signal: controller.signal,
});

controller.abort();

try {
  await pending;
} catch (error) {
  console.error(error);
}
```

Bu durumda hata kodu `ABORTED` olur.

## Yeniden deneme

Başarısız istekler varsayılan olarak tekrar gönderilmez. Açmak isterseniz:

```ts
const client = new TefasClient({ maxRetries: 2 });
```

`maxRetries`, `0`, `1` veya `2` olabilir. `2` seçerseniz ilk istekle birlikte en fazla üç deneme yapılır.

Yalnızca ağ hataları ve HTTP `429`, `502`, `503`, `504` yanıtları tekrar denenir. Diğer hatalarda, iptalde veya zaman aşımında işlem durur.

Denemeler arasında kısa bir bekleme vardır. TEFAS'ın `Retry-After` başlığıyla istediği bekleme süresi de dikkate alınır. Bu süre 60 saniyeyi aşıyorsa veya başlık anlaşılamıyorsa tekrar denenmez. Toplam zaman aşımı her durumda geçerlidir.

## Hata yakalama

```ts
import { TefasClient, TefasError } from "tefas-js";

const client = new TefasClient();

try {
  const history = await client.getPriceHistory("TI2", { periodMonths: 12 });
  console.log(history.prices);
} catch (error) {
  if (error instanceof TefasError) {
    console.error(error.code, error.message);
  } else {
    throw error;
  }
}
```

| Kod | Anlamı |
| --- | --- |
| `INVALID_ARGUMENT` | Fon kodu veya seçenekler geçersiz. |
| `ACCESS_DENIED` | TEFAS erişimi reddetti (HTTP 401 veya 403). |
| `HTTP_ERROR` | Diğer başarısız HTTP yanıtları. |
| `SOURCE_ERROR` | TEFAS, yanıtın içinde hata bildirdi. |
| `INVALID_RESPONSE` | Yanıt beklenen biçimde değil. |
| `NETWORK_ERROR` | Bağlantı kurulamadı veya yanıt okunamadı. |
| `TIMEOUT` | İstek için ayrılan süre doldu. |
| `ABORTED` | İstek kullanıcı tarafından iptal edildi. |

Hataya göre `status`, `sourceCode`, `retryAfterMs` ve `cause` alanları da bulunabilir. Kodunuzda hataları ayırmak için mesaj yerine `code` alanını kullanın.

## TEFAS'a istek gönderirken

Çok sayıda isteği kısa sürede göndermek TEFAS tarafından engellenmenize yol açabilir. Birden fazla fonu sorgularken istekleri tek tek gönderin ve aralarında bekleyin. `getDailyHistory` kendi parçalarını bekleyerek sırayla getirir; diğer çağrılar için ortak bir istek kuyruğu yoktur.

Erişim engellenirse hata döner. Kütüphane tarayıcı taklidi yapmaz veya bu engeli aşmaya çalışmaz.

## Geliştirme

`package.json` dosyasındaki Bun sürümünü kullanın.

Kaynak kod, testler ve geliştirme betikleri TypeScript ile yazılır. Node.js kontrollerinde önce JavaScript'e derlenir; Bun testleri doğrudan TypeScript dosyalarını çalıştırır. npm paketinde derlenmiş kütüphane, tip dosyaları, paket bilgileri ve belgeler bulunur.

```sh
bun install --frozen-lockfile
bun run check
bun run verify:package
```

`check`, TypeScript kontrolünü, derlemeyi ve Node.js/Bun testlerini çalıştırır. `verify:package`, bunlara ek olarak arşivin içeriğini ve ayrı bir projede kurulup kullanılabildiğini kontrol eder.

Gerçek TEFAS bağlantısını denemek için:

```sh
bun run smoke:live
bun run smoke:live -- TI2
bun run smoke:live -- TI2 2026-10-23
```

Bu komut sekiz istemci metodunu toplam dokuz gerçek istekle kontrol eder. Kontroller arasında en az 12 saniye bekler; 40 günlük geçmiş sorgusu da 12 saniye arayla iki parçada yapılır. Yaklaşık iki dakika veya daha uzun sürebilir. Yeniden deneme kapalıdır; bir kontrol başarısız olursa kalanlar çalıştırılmaz.

İlk argüman fon kodu (varsayılan `TI2`), ikincisi `YYYY-MM-DD` biçiminde referans tarihidir. Tarih verilmezse Türkiye takvimine göre önceki hafta içi gün kullanılır. Kontrol `YAT` türündeki yatırım fonları içindir. Resmî tatil veya yayımlanmamış veri nedeniyle sonuç boşsa başka tarihleri otomatik taramaz; tamamlanmış bir iş günü seçin. Tarih aralığı referans tarihle biten, iki ucu dahil 40 gündür.

Canlı kontrol normal testlere veya CI'a dahil değildir. CI matrisi Node.js 22 ve 24 ile Windows ve Linux'u kapsar; gerçek çalışma sonucunu GitHub'daki workflow kaydından kontrol edin.

## Projenin durumu

Fon listesi, arama, fiyat sorgusu, günlük fon verileri, tarih aralığıyla günlük geçmiş, varlık dağılımı, getiri karşılaştırması ve fon tipi mevcut. Günlük veriler üzerinde sıralama ve özet de yapılabilir. Önbellekleme henüz yok. API, sonraki 0.x sürümlerinde değişebilir.

Paket ESM olarak sunulur. CommonJS ve tarayıcı desteği yoktur. Kurulumda veya import sırasında istek gönderilmez. İstemci metotları ağ isteği yapar; `searchFunds`, `topFunds` ve `summarizeMarket` yapmaz.

## Sürüm notları

### 0.2.0

`getDailyHistory` ile tarih aralığıyla, hız sınırlı günlük geçmiş eklendi.

`getComparison` ile getiri karşılaştırması, `getFundType` ile fon tipi eklendi.

`getAllocation` ile fonun varlık dağılımı eklendi.

`getSnapshot` ve `getSnapshots` ile günlük fon verileri, `topFunds` ve `summarizeMarket` ile yerel sıralama ve özet eklendi.

`listFunds` ile fon listesi ve kurucu bilgileri, `searchFunds` ile yerel arama eklendi.

Haftalık ve YTD sorguları için `period` seçeneği eklendi. Mevcut `periodMonths` çağrıları çalışmaya devam ediyor.

`PriceHistory.periodMonths` artık `HistoryPeriodMonths | null`. Bu alanı kullanan TypeScript kodunda `null` kontrolü gerekebilir. Sonuca her zaman dolu olan `period` alanı da eklendi.

`0.1.1` kullananlar `getPriceHistory` ve `periodMonths` ile devam edebilir; yeni metotlar için `0.2.0` gerekir.

## Lisans

[MIT](LICENSE).

Bu proje TEFAS'ın resmî bir kütüphanesi değildir. MIT lisansı kod için geçerlidir; TEFAS verilerini kullanma veya servise erişim izni vermez.
