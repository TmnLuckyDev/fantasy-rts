# Ash & Iron: Idébank

Dette dokument samler forslag til fremtidig udvikling af **Ash & Iron**.

Forslagene er ikke implementeret, medmindre status udtrykkeligt er ændret. Nye ideer tilføjes fortløbende med et unikt nummer. Implementering besluttes separat.

## Oversigt

| ID | Idé | Status |
| --- | --- | --- |
| 001 | Army Group Templates | Idé, ikke implementeret |
| 002 | Town Hall progression og dyrere enhedsopgraderinger | Idé, ikke implementeret |

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

---

## 002: Town Hall progression og dyrere enhedsopgraderinger

**Status:** Idé, ikke implementeret  
**Område:** Teknologitræ, bygninger, enheder og balance

### Formål

Ash & Iron skal have en tydelig progression, hvor spilleren opgraderer sin Town Hall (eller racens tilsvarende hovedbygning) for at få adgang til mere avancerede bygninger og enheder. Opgraderinger kræver først, at bestemte bygninger er opført.

### Foreslået progression

| Niveau | Krav før opgradering | Hvad låses op |
| --- | --- | --- |
| Town Hall niveau 1 (start) | Ingen opgradering nødvendig | Basisbygninger, grundlæggende barracks og de første enheder |
| Town Hall niveau 2 | Første barracks til basisenheder samt racens opgraderingsbygning, eksempelvis Blacksmith / War Forge | Forsvarstårne og adgang til Archers og tilhørende bygninger |
| Town Hall niveau 3 | Kræver udvalgte bygninger fra niveau 2, herunder bygninger til ranged units og forsvar | De stærkeste enheder og havne/ports, så vandbaseret gameplay kan åbnes |

**Bemærk:** Tabellen beskriver det ønskede princip. Den endelige liste over obligatoriske bygninger, racernes navne, omkostninger og oplåste enhedstyper skal fastlægges ved design og balancering.

### Funktionelle krav

1. Spilleren skal kunne opgradere sin Town Hall i flere trin.
2. Opgraderingsknappen skal vise, hvilke bygninger der kræves, og hvilke krav der endnu mangler.
3. Alle racer skal have en passende opgraderingsbygning, for eksempel Blacksmith til Humans og War Forge eller tilsvarende til andre racer.
4. Niveau 1 skal fokusere på basisenheder og grundlæggende produktion.
5. Den første Town Hall-opgradering skal give adgang til forsvarstårne og ranged units såsom Archers.
6. Efter at spilleren har bygget de krævede bygninger fra næste trin, skal den sidste opgradering åbne for eliteenheder og havne/ports til vand.
7. Præcis progression kan være racetilpasset, men skal være sammenlignelig i styrke og tempo mellem racerne.

### Balancering af enhedsopgraderinger

Eksisterende opgraderinger eller level-ups til enheder skal blive **væsentligt dyrere på højere niveauer**, fordi de giver store kampmæssige fordele.

Designretning:
- Højere niveauer skal have tydeligt stigende omkostninger i ressourcer og eventuelt forskningstid.
- En spiller skal prioritere mellem flere enheder, økonomi og stærkere opgraderede enheder.
- De højeste opgraderinger skal ikke kunne opnås for tidligt, og det kan overvejes at koble dem til Town Hall-niveau.
- Omkostninger og effekt skal balanceres på tværs af alle racer, så én strategi ikke dominerer.

### Afklares ved planlægning

- Præcis hvilke bygninger kræves ved hvert Town Hall-niveau?
- Hvilke enhedstyper og bygninger bliver tilgængelige på hvert niveau for hver race?
- Hvilke vandmekanikker og enheder skal ports understøtte?
- Hvad er de nuværende opgraderingsniveauer, effekter og omkostninger, og hvor meget skal priserne hæves?
- Skal eksisterende bygninger beholde deres funktion, hvis Town Hall senere ødelægges?

**Implementeringsbeslutning:** Ingen ændringer i spillet nu. Idéen er kun registreret til senere prioritering.
