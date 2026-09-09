# Dystrybucja artefaktów AI — decyzja (M5L4, zadanie 1)

## Kto jest odbiorcą artefaktów AI?

Deweloperzy pracujący w repozytoriach zespołu na **GitHubie** (OrderLY:
`Majloner/OrderLy`; CI już działa na GitHub Actions, uprawnienia nadaje
członkostwo w repo/organizacji). Artefakty to skille, reguły i prompty dla
Claude Code — konsumowane wyłącznie wewnętrznie, bez odbiorców zewnętrznych
i bez bramkowania dostępu innego niż dostęp do repozytorium.

## Wybrany model: **Model 1 — prywatna paczka npm na GitHub Packages**

Odbiorcą jest zespół, który już uwierzytelnia się do GitHuba, więc rejestr
`npm.pkg.github.com` daje wersjonowanie, kontrolę dostępu i publikację przez
efemeryczny `GITHUB_TOKEN` bez utrzymywania żadnej nowej infrastruktury.
Instalacja u konsumenta to jeden wpis w `.npmrc` i `npm install` —
najniższy możliwy koszt adopcji przy pełnym przepływie „rejestr → wersje →
instalator/deinstalator".

## Dlaczego nie model cięższy (kontrola pokusy)

Model 2 (AWS CodeArtifact + Terraform + OIDC) kusi „profesjonalną" otoczką,
ale zespół nie ma współdzielonej infrastruktury AWS, a żaden wymóg
(compliance, sieć prywatna, odbiorca poza GitHubem) go nie uzasadnia — byłby
to czysty koszt utrzymania bez wartości. Model 3 (API+CLI z bramkowaniem)
odpada, bo nie ma odbiorcy zewnętrznego ani modelu uprawnień innego niż
dostęp do organizacji GitHub.

## Zadanie 2 (doprecyzowanie przez /10x-shape → /10x-prd → /10x-roadmap)

Pominięte świadomie: decyzja nie jest niepewna — odbiorca, ograniczenia
dostępu i stack są jednoznaczne (patrz wyżej), a lekcja każe doprecyzowywać
tylko przy niepewności.
