# Ash & Iron: Idébank

Dette dokument samler forslag til fremtidig udvikling af **Ash & Iron**.

Forslagene er ikke implementeret, medmindre status udtrykkeligt er ændret. Nye ideer tilføjes fortløbende med et unikt nummer. Implementering besluttes separat.

## Oversigt

| ID | Idé | Status |
| --- | --- | --- |
| 001 | Army Group Templates | Idé, ikke implementeret |

---

## 001: Army Group Templates

**Status:** Idé, ikke implementeret  
**Område:** Hærstyring og rekruttering

### Formål

Spilleren skal kunne oprette navngivne hærgrupper med en bestemt ønsket sammensætning af enheder. Rekrutterede enheder skal automatisk kunne udfylde ledige pladser i gruppen, også når der er opstået tab.

### Eksempel

**Gruppe 1: Main Army**

Samlet styrke: **40/45**

| Enhedstype | Nuværende | Ønsket | Visning |
| --- | ---: | ---: | --- |
| Soldiers | 20 | 20 | 20/20 |
| Archers | 15 | 20 | 15/20 |
| Ballistas | 5 | 5 | 5/5 |
| **I alt** | **40** | **45** | **40/45** |

### Ønsket funktionalitet

1. Spilleren kan oprette en gruppe og give den et navn.
2. Spilleren vælger præcis hvilke enhedstyper og hvor mange af hver, gruppen skal indeholde.
3. Når nye enheder bliver rekrutteret, tildeler spillet dem automatisk til gruppen, så længe der er ledige pladser for den pågældende enhedstype.
4. Hvis gruppen mister enheder, åbnes der tilsvarende pladser. Mister den eksempelvis 8 Archers, kan 8 nye Archers automatisk tilføjes.
5. Spilleren kan ændre gruppens ønskede sammensætning undervejs.
6. Gruppen viser både nuværende og ønsket antal enheder, herunder det samlede antal.

### Mulig senere udvidelse: Replenish Group

En knap med navnet **Replenish Group** kan automatisk sætte gruppens manglende enheder i rekrutteringskøerne, hvis spilleren har ressourcer nok.

Eksempel: Har Main Army 15/20 Archers, forsøger funktionen at sætte 5 Archers i kø.

Dette er en senere udvidelse og ikke et krav til den første version af Army Group Templates.

### Afklares ved planlægning

- Hvilken gruppe får først nye enheder, hvis flere grupper mangler samme enhedstype?
- Hvordan skal spilleren kunne flytte enheder mellem grupper eller fjerne dem fra en gruppe?
- Hvordan skal systemet håndtere kapacitet, rekrutteringskøer og ressourcemangel?

**Implementeringsbeslutning:** Ingen ændringer i spillet nu. Idéen er kun registreret til senere prioritering.
