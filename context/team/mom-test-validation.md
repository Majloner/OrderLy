# Mom Test Validation Plan

## Input Idea

Kandydat z `context/team/opportunity-map.md` (2026-09-06): **„Kto-ma-co + planer aktualizacji"** — rejestr wersji iTOOLS per klient (CSV) połączony z manifestem „wersja → skrypty SQL", renderowany do read-only digestu. Ból zgłoszony: wdrożeniowcy dopytują na WhatsAppie o wersje u klientów, a dobór skryptów uzupełniających bazę (`wdrozenie_*.sql`) zależny od wersji startowej jest ręczny.

## Hypotheses

- **User/role**: wdrożeniowcy iTOOLS (wdrożenia i aktualizacje u klientów); wtórnie deweloper (bus factor = 1) odpowiadający na pytania.
- **Friction**: (a) brak miejsca z odpowiedzią „który klient ma którą wersję"; (b) ręczny dobór skryptów SQL wg wersji startowej klienta.
- **Current workaround**: pamięć + czaty WhatsApp; ręczny wybór spośród `wdrozenie_RW.sql` / `wdrozenie_komplet.sql`.
- **Risky assumptions**:
  1. pytania o wersję są częste (nie 2×/rok);
  2. pomyłki doboru skryptów miały realny, policzalny koszt;
  3. klienci są rzeczywiście rozproszeni po wielu wersjach;
  4. rytuał „wdrożenie = wpis do rejestru" utrzyma się w praktyce;
  5. `wdrozenie_komplet.sql` NIE jest już idempotentnym rozwiązaniem problemu doboru (jeśli jest — S2 nie istnieje).
- **Evidence already present**: pliki `wdrozenie_*.sql` w repo; nota o możliwym dryfie `docs/schema-obecny.sql` (repo-map iTOOLS); relacja użytkownika. **Brak**: liczb (częstotliwość pytań) i udokumentowanych incydentów — mapa jest dopracowana, dowody cienkie.

## Critique

1. **Rozwiązanie vs problem:** „rejestr + planer" to już rozwiązanie; ból potwierdza jedna relacja bez liczb. Wiadomości na WhatsAppie są policzalne (przewiń historię czatu) — policzyć przed uwierzeniem pamięci.
2. **Intencja vs zachowanie:** „będą wpisywać do CSV" to przyszłość. Test z przeszłości: czy ktokolwiek prowadzi dziś choćby prywatną listę klient→wersja? Jeśli nie — zbiorowy rytuał tym bardziej padnie.
3. **Co obala pomysł:** pytania rzadsze niż 1/tydzień; klienci skupieni na 1–2 wersjach; `wdrozenie_komplet.sql` obsługujący dowolną wersję startową.
4. **Istniejące może wystarczyć:** firmowy CRM/ERP **iOffice** ma kartoteki klientów — pole „wersja iTOOLS + data aktualizacji" tam, plus reguła procesu, może zamknąć S1 bez nowego narzędzia. Kod broni się dopiero na złączeniu ze skryptami.
5. **Mocny dowód „proceed":** ≥3 konkretne historie z ostatniego miesiąca z policzalnym kosztem (czas, rollback, przestój u klienta).

## Interview Guide

20–30 min, rozmówca: wdrożeniowiec. Pytania neutralne, o przeszłe zachowania; follow-upy w nawiasach.

**Rozgrzewka (rola, przepływ, częstotliwość)**
1. Ile wdrożeń/aktualizacji iTOOLS robisz miesięcznie i u ilu klientów?
2. Przeprowadź mnie przez OSTATNIĄ aktualizację u klienta — krok po kroku, od decyzji po potwierdzenie, że działa.

**Świeża historia**
3. Kiedy ostatnio musiałeś ustalić, jaką wersję ma klient? Jak dokładnie to zrobiłeś i ile trwało?
4. Ile razy w ostatnim miesiącu pytałeś (albo Ciebie pytano) na WhatsAppie o wersję u klienta? *(pokaż czat, jeśli można)*

**Obecny workaround**
5. Prowadzisz gdzieś własną listę klient→wersja — notes, Excel, głowa? *(pokaż)*
6. Jak ustalasz, które skrypty SQL wykonać przy aktualizacji? Co robisz, gdy wersja startowa jest bardzo stara? *(czy `wdrozenie_komplet.sql` załatwia każdą?)*

**Koszt bólu**
7. Kiedy ostatnio dobór skryptów poszedł źle albo prawie źle? Co się stało i ile kosztowała naprawa? *(kto jeszcze był zaangażowany?)*
8. Co dzieje się u klienta, gdy aktualizacja się przeciąga albo baza jest niedograna?

**Istniejące alternatywy**
9. Czy próbowaliście już czegoś — lista w SharePoint, pole w iOffice, notatki przy instalatorze? Co się z tym stało / dlaczego umarło?

**Sygnał decyzyjny**
10. Co musiałoby się zmienić w procesie wdrożenia, żebyś przestał pytać na WhatsAppie? *(neutralnie — nie podsuwać digestu)*

**Zamknięcie**
11. Mogę zajrzeć do zanonimizowanej historii czatu WhatsApp z ostatnich 2 miesięcy i wrócić za tydzień?

## Survey

Zastrzeżenie: przy 2–5 wdrożeniowcach ankieta ma sens tylko po poszerzeniu grupy (serwis, wsparcie). 7 pytań:

1. **Screener:** Czy w ostatnich 3 miesiącach wdrażałeś/aktualizowałeś iTOOLS u klienta LUB odpowiadałeś na pytania o wersję u klienta? (tak / nie → koniec)
2. Jak często musisz ustalić wersję iTOOLS u konkretnego klienta? (codziennie / kilka razy w tygodniu / kilka razy w miesiącu / rzadziej)
3. Jak ostatnio to ustaliłeś? (pytanie na WhatsAppie / pytanie do dewelopera / własna lista / zdalny podgląd u klienta / inne — jakie?)
4. Ile zajęło ostatnie takie ustalenie? (<5 min / 5–30 min / >30 min / nie udało się tego dnia)
5. Czy w ostatnich 3 miesiącach zdarzył się błędny/niepełny dobór skryptów SQL przy aktualizacji? (tak, z konsekwencjami u klienta / tak, wychwycony przed skutkami / nie / nie wiem)
6. **Otwarte:** Opisz ostatni przypadek, gdy brak wiedzy o wersji lub skryptach spowolnił pracę.
7. **Otwarte:** Gdzie dziś zapisujesz (jeśli w ogóle) wersje u klientów?

## Decision Criteria

- **Proceed**: ≥3 z ~5 rozmówców opisuje bez podpowiedzi ten sam workaround (własna lista / pytanie na WhatsAppie) ORAZ pytania o wersję padają łącznie ≥1×/tydzień ORAZ w ostatnim kwartale wystąpił ≥1 incydent doboru skryptów z policzalnym kosztem.
- **Narrow scope**: pytania częste, ale dobór skryptów bezproblemowy (`komplet.sql` wystarcza) → budować wyłącznie rejestr, i to raczej jako pole w iOffice / listę SharePoint, bez kodu.
- **Do not build yet**: pytania <1/miesiąc, klienci na maksymalnie 2 wersjach, zero incydentów doboru.
- **Try existing tool/process first**: pole „wersja iTOOLS + data" w kartotece klienta w iOffice + reguła procesu „aktualizacja = wpis". Do planera wracać dopiero, gdy pole żyje ≥1 miesiąc (tani test założenia #4 o rytuale) i nadal brakuje złączenia ze skryptami.
