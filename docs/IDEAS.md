# Ash & Iron: Idébank

Dette dokument samler forslag til fremtidig udvikling af **Ash & Iron**.

Forslagene er ikke implementeret, medmindre status udtrykkeligt er ændret. Nye ideer tilføjes fortløbende med et unikt nummer. Implementering besluttes separat.

## Oversigt

| ID | Idé | Status |
| --- | --- | --- |
| 001 | Army Group Templates | Implementeret |
| 002 | Town Hall progression og dyrere enhedsopgraderinger | Implementeret |
| 003 | Dyrere, vigtigere og større helte | Implementeret |

---

## 001: Army Group Templates

**Status:** Implementeret
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

Replenish er implementeret. Eksisterende køer trækkes fra behovet, og gruppens placering i oprettelsesrækkefølgen afgør prioriteten.

### Afklares ved planlægning

- Hvilken gruppe får først nye enheder, hvis flere grupper mangler samme enhedstype?
- Hvordan skal spilleren kunne flytte enheder mellem grupper eller fjerne dem fra en gruppe?
- Hvordan skal systemet håndtere kapacitet, rekrutteringskøer og ressourcemangel?

**Implementeringsbeslutning:** Se implementeringen nedenfor.

---

## 002: Town Hall progression og dyrere enhedsopgraderinger

**Status:** Implementeret
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

### Balance mellem Town Hall-niveauer

En vigtig balanceovervejelse er at undgå, at en spiller, som først når Level 2, får en næsten uovervindelig fordel. Derfor bør prisen og tiden for hver opgradering stige.

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

**Implementeringsbeslutning:** Se implementeringen nedenfor.

---

## 003: Dyrere, vigtigere og større helte

**Status:** Implementeret
**Område:** Helte, visuel fremtoning og spilbalance

### Formål

Helte skal være sjældnere og væsentligt sværere at få, men til gengæld spille en meget vigtigere rolle på slagmarken. De skal fremstå som markante, særligt værdifulde enheder, både visuelt og strategisk.

### Ønsket funktionalitet

1. **Højere pris:** Helte skal koste betydeligt flere ressourcer end nu og eventuelt tage længere tid at rekruttere. Det skal være en mærkbar investering.
2. **Sværere adgang:** Det kan overvejes at kræve et højere Town Hall-niveau eller bestemte bygninger før rekruttering, i sammenhæng med idé #002.
3. **Større betydning:** Helte skal have en mere afgørende rolle i kamp gennem tydelige styrker, unikke evner, støtte til nærliggende enheder og/eller stærkere kampegenskaber. Hver helt skal have en tydelig taktisk identitet.
4. **Større visuelt:** Heltes figurer skal være tydeligt større end almindelige enheder, og større end de er nu. De skal være nemme at genkende i en hær, især på mobil.
5. **Betydningsfulde tab:** At miste en helt skal have strategisk betydning, men må ikke gøre en kamp automatisk tabt. Genanskaffelse og eventuel genoplivning skal balanceres.
6. **Passiv heling over tid:** Helte skal automatisk genvinde HP gradvist efter at have taget skade. Helingen skal være langsom nok til, at skade og tilbagetrækning stadig har betydning, men hurtig nok til, at en overlevende helt kan bruges igen efter en kamp uden at skulle rekrutteres på ny.

### Design- og balancehensyn

- Helte skal kunne ændre udfaldet af et slag ved korrekt brug, men bør ikke alene udslette store hære.
- Pris, styrke, evner og tilgængelighed skal sammenlignes på tværs af racer.
- Større visuelle modeller må ikke skabe upræcise trykflader, uhensigtsmæssig kollision eller problemer med troppeformationer.
- Helte skal være nemme at vælge og følge på mobil uden at dække uforholdsmæssigt meget af slagmarken.
- Passiv healing skal balanceres, så helte ikke bliver næsten umulige at slå ihjel under kamp. Det kan overvejes, om healing først starter efter en periode uden at tage skade.

### Afklares ved planlægning

- Hvad skal helte koste sammenlignet med deres nuværende pris?
- Kræver de et bestemt Town Hall-niveau eller specielle bygninger?
- Hvilke konkrete evner eller buffs gør hver helt mere betydningsfuld?
- Hvor meget skal heltenes sprites og eventuelle markeringer forstørres?
- Hvilke konsekvenser skal det have at miste en helt?
- Hvor hurtigt skal passiv HP-regenerering ske, og skal den pauses under kamp?

**Implementeringsbeslutning:** Se implementeringen nedenfor.

## Regler i spillet

- **Army groups** findes i Production. Nye rekrutter går til den første gruppe med plads til typen. En enhed kan kun tilhøre én gruppe. Spilleren kan også tildele eller fjerne enheder manuelt.
- **Town Hall** starter på niveau 1 i nye kampe. Niveau 2 kræver færdige Barracks og Blacksmith eller racens tilsvarende bygninger. Det koster 240 guld, 150 træ og 70 sten og tager 24 sekunder. Niveau 3 kræver en færdig ranged-bygning og et tårn. Det koster 480 guld, 280 træ og 150 sten og tager 44 sekunder.
- Forskningens pris tredobles fortsat pr. trin. Forskningstrin 2 og 3 kræver Town Hall 2. Trin 4 og 5 kræver Town Hall 3. Forskningstiden stiger med 35 procent af grundtiden pr. trin.
- Helte kræver Town Hall 3, koster 460 guld og 80 træ og tager 24 sekunder. Hver side kan have én aktiv eller køsat helt. Helte har 12 procent mere grund-HP, 2 mere grundskade og genvinder cirka 1,5 procent af maksimalt HP pr. sekund efter 8 sekunder uden kamp.
- Ældre gemte kampe bevarer deres adgang til bygninger og forskning. Øvelseskampen bruger åbne bygninger til de guidede opgaver.
