# tefas-js

[Türkçe](README.md) | [English](README.en.md)

TEFAS verilerine erişmek için JavaScript/TypeScript kütüphanesi.

Fon listesini alabilir, fon arayabilir ve fiyat verisi çekebilirsiniz. Node.js 22 ve üzeriyle çalışır, ek bağımlılık gerektirmez.

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

Çok sayıda isteği kısa sürede göndermek TEFAS tarafından engellenmenize yol açabilir. Birden fazla fonu sorgularken istekleri tek tek gönderin ve aralarında bekleyin. Kütüphane sizin yerinize istek kuyruğu oluşturmaz.

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
```

Bu komut tek bir istek gönderir. Normal testlere veya CI'a dahil değildir. CI'da Node.js 22 ve 24, Windows ve Linux üzerinde kontrol edilir.

## Projenin durumu

Fon listesi, arama ve tek fonun fiyat sorgusu mevcut. Günlük detaylar, varlık dağılımı, toplu sorgu ve önbellekleme henüz yok. API, sonraki 0.x sürümlerinde değişebilir.

Paket ESM olarak sunulur. CommonJS ve tarayıcı desteği yoktur. Kurulumda veya import sırasında istek gönderilmez. `getPriceHistory` ve `listFunds` ağ isteği yapar; `searchFunds` yapmaz.

## Sürüm notları

### 0.2.0 — hazırlanıyor

`listFunds` ile fon listesi ve kurucu bilgileri, `searchFunds` ile yerel arama eklendi.

Haftalık ve YTD sorguları için `period` seçeneği eklendi. Mevcut `periodMonths` çağrıları çalışmaya devam ediyor.

`PriceHistory.periodMonths` artık `HistoryPeriodMonths | null`. Bu alanı kullanan TypeScript kodunda `null` kontrolü gerekebilir. Sonuca her zaman dolu olan `period` alanı da eklendi.

Bu değişiklikler henüz npm'de yayımlanmadı. Yayımlanmış `0.1.1` sürümünde `periodMonths` kullanılmalı.

## Lisans

[MIT](LICENSE).

Bu proje TEFAS'ın resmî bir kütüphanesi değildir. MIT lisansı kod için geçerlidir; TEFAS verilerini kullanma veya servise erişim izni vermez.
