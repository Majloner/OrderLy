## OrderLY - MVP

> *Keep your orders orderly.*

### Główny problem
Małe i średnie lokale gastronomiczne zarządzają menu, cennikiem i dostępnością produktów w sposób rozproszony (kartki, pliki, telefon do dostawcy), a obsługa zamówień przy stoliku wymaga zaangażowania kelnera na każdym etapie. Brakuje prostego, taniego narzędzia, które w jednym miejscu pozwoli prowadzić aktywne menu ze zdjęciami, udostępni je klientom przez stały kod QR przy stoliku oraz umożliwi składanie i obsługę zamówień zarówno przez klienta, jak i personel.

### Stos technologiczny i hosting
- **Multi-tenancy:** współdzielona baza danych z kolumną `company_id` w każdej tabeli, zapewniającą izolację danych poszczególnych firm.
- **Rekomendowany hosting: Supabase** — spójna platforma łącząca w jednym miejscu wszystko, czego potrzebuje MVP:
  - baza **PostgreSQL** z mechanizmem **Row Level Security**, który na poziomie bazy wymusza dostęp tylko do wierszy z właściwym `company_id` (idealne pod izolację firm),
  - wbudowane **uwierzytelnianie** i obsługa kont/ról użytkowników,
  - **storage na pliki** do przechowywania zdjęć potraw (poza bazą), z możliwością generowania miniatur.
- **Alternatywa (rozdzielone usługi):** frontend na Vercel/Netlify, backend na Railway/Render, zdjęcia na Cloudflare R2 lub AWS S3, baza PostgreSQL u dowolnego dostawcy. Daje większą elastyczność kosztem złożoności konfiguracji.
- Na potrzeby projektu certyfikacyjnego rekomendowane jest Supabase ze względu na najmniejszy narzut konfiguracyjny i wbudowane wsparcie dla wielofirmowości oraz ról.

### Najmniejszy zestaw funkcjonalności
- Rejestracja i logowanie firmy (konto lokalu) z podstawowym profilem (nazwa, adres, godziny otwarcia)
- System ról w obrębie firmy: **właściciel**, **kelner**, **kuchnia** — z różnym zakresem uprawnień
- **Dedykowany widok kuchni** (kitchen display) dopasowany do pracy w kuchni: lista pozycji do przygotowania, sortowanie wg statusu, oznaczanie pozycji jako gotowe
- Tworzenie i edycja aktywnego menu: pozycje, opisy, ceny, kategorie
- Dodawanie zdjęć potraw i produktów do pozycji menu
- Definiowanie **składników** pozycji oraz oznaczanie **alergenów**
- **Wielojęzyczne menu** z tłumaczeniem wspomaganym przez AI: tłumaczenie generowane **na żądanie**, gdy danego języka nie ma jeszcze w systemie, a następnie **zapisywane w bazie** (cache), by przy kolejnych wyświetleniach było serwowane bez ponownego wywołania AI
- Moduł **dostępności**: oznaczanie pozycji jako dostępna/niedostępna/wyprzedana w czasie rzeczywistym
- Edytor schematu sali: dodawanie stolików oraz ich **aktywacja i dezaktywacja** (np. dla stolików sezonowych)
- Identyfikacja stolika jako **nazwa lokalu + numer**, z opcjonalnym dodatkowym opisem
- **Stały kod QR** przypisany na trwałe do stolika (nie zmienia się przy edycji menu)
- **Składanie zamówień przez klienta** po zeskanowaniu kodu QR — **anonimowo, bez rejestracji** (sesja przypisana do stolika) — oraz przez personel
- Zmiana statusu zamówienia (przyjęte → w przygotowaniu → w realizacji → zrealizowane)
- Reguła edycji: zamówienie tworzą zarówno klient, jak i personel, ale po zmianie statusu na **„w realizacji"** edytować je może **wyłącznie personel**
- **Rozliczenie i podsumowanie** zamówienia widoczne w systemie (kwota, pozycje); **płatność realizowana w kasie**, poza systemem (płatności online dopiero w fazie 2)

### Co NIE wchodzi w zakres MVP
- Płatności online i integracja z bramkami/terminalami płatniczymi (faza 2)
- Fiskalizacja i integracja z kasami/POS (planowana, ale poza zakresem projektu certyfikacyjnego)
- Zarządzanie magazynem i automatyczne odejmowanie składników ze stanu
- Moduł rezerwacji stolików
- Aplikacje mobilne natywne (na początek tylko web, responsywny)
- Zaawansowana analityka i raporty sprzedaży
- Obsługa sieci wielu lokalizacji w ramach jednego konta

### Kryteria sukcesu
- Lokal jest w stanie samodzielnie skonfigurować pełne menu (min. 20 pozycji ze zdjęciami) w mniej niż 30 minut
- 80% pozycji w aktywnym menu ma przypisane zdjęcie
- Klient jest w stanie złożyć zamówienie ze stolika przez kod QR bez udziału personelu
- Co najmniej 70% aktywnych stolików ma wygenerowany i przypisany stały kod QR
- Tłumaczenie AI poprawnie pokrywa min. 90% pozycji menu w wybranym dodatkowym języku
- Personel obsługuje zamówienie w panelu szybciej niż w dotychczasowym procesie papierowym

---

### Uwagi i podjęte decyzje

**Decyzje projektowe**
- Klient zamawia anonimowo (bez rejestracji), płatność następuje w kasie poza systemem.
- Tłumaczenie AI uruchamiane na żądanie tylko dla brakujących języków; wynik zapisywany w bazie i ponownie wykorzystywany.
- Rola „kuchnia" ma osobny, dopasowany widok (kitchen display), oddzielony od panelu kelnera.
- Stoliki identyfikowane przez nazwę lokalu + numer, z opcjonalnym opisem; kod QR stały, stoliki aktywowane/dezaktywowane (np. sezonowe).

**Propozycje rozszerzeń (faza 2+)**
- Płatności online i podział rachunku między gości przy jednym stoliku.
- Powiadomienia dla personelu i kuchni o nowym zamówieniu z QR (dźwięk/badge w panelu).
- Warianty i dodatki do pozycji (rozmiar, sosy, „bez cebuli") — bardzo częste w gastronomii.
- Historia zamówień klienta w obrębie sesji stolika.
