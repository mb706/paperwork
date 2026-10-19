# R3 accuracy: source log

Working notes from the verification passes behind `R3-accuracy.md`, with source URLs for the claims that §4 lists as verified. "ERR" marks an item reported as an issue in the main document. This is a log, not a spec.

Confirmed by me (no agent needed):
- Decider = 2.0 multi-condition (10-architecture table: "Multiple conditions and multiple outputs, per-wire input selection"); data name "Threshold unit", desc "Outputs when its input crosses a threshold"; cybernetics desc "a decider is a threshold unit" contradicts 08 §14 #3.
- Speed modules 2.0: quality -1/-1.5/-2.5% (since 2.0.7) missing in items.yaml coprocessor 1-3. https://wiki.factorio.com/Speed_module
- Solar panel desc "Adds no heat where it stands." contradicts 08 §11 #28.
- Watermarking desc has σ and "Your" (08 §10.1 symbols never in UI; P7).
- 03 §3.4 "sets from Penetration testing" vs data (Reference monitor unlocks Evaluation set).
- meta.yaml salvage entity "Radar laboratory salvage" + contents {iron-plate 20, gear 10, cable 20, logic-board 8} vs 01 §9 (1 radar, 10 logic-board, 20 cable; wreck pieces 5 iron each); 10-architecture "Rad Lab salvage".
- Spelling: neighbour(s) x5 (lateral-inhibition, nuclear-reactor x2, fusion-reactor x2, accelerator-3), labelled (curated-corpora).
- "robot" in mobile-robotics name+desc (08 §10.2 never-list).
- Model collapse penalty global (not provenance): Dataset = 20 prose + 1 token; prose from crawl (refinery) or Synthetic data (archive tokens).
- Diebold 1952 (Van Nostrand), Pease 1952 Sci Am 187(3), Harrington 1973 (Industrial Press, (c)1973, imprint 1974): OK.
- Rosenthal 1979 abstract: "the journals are filled with the 5% of the studies that show Type I errors, while the file drawers are filled with the 95% of the studies that show nonsignificant (e.g., p > .05) results." => Analysis 5%/95% = Rosenthal's extreme view exactly. KEEP. https://psycnet.apa.org/record/1979-27602-001 (abstract), arXiv physics/9909033 (Scargle) quotes it.
- Fail-safe N for 40 studies at z~2: (sum z)^2/2.706 - k ~ 2325 nulls; so 3 nulls cannot nullify -> Meta-analysis recipe consistent.
- 03 §1.2 C=20 MJ/K "about the heat capacity of a chunk's air and topsoil": air rho*cp=1.206 kJ/m3K x 1024 m2 -> 20 MJ/K = 16 m of air or ~9 mm of soil (2.2 MJ/m3K). Real boundary layer ~1 km (1,235 MJ/K), diurnal soil depth ~10 cm (225 MJ/K). Parenthetical false by 10-60x; it's a game constant.
- Arithmetic OK: 01 §3 gradient/sunlight; 01 §7.2 66,500 s; 04 exponent r/(r-1)=2.408; 9,600 cards; q=0.75; 2^20; 07 Field 1984.6; 07 loss curve 3.41->1.92.
AGENT 2 (AI classics) key results:
- ERR Brooks desc: robots "tether-free and without any communication link"; legs -> Brooks 1989 Neural Comp 1(2):253-262 (Genghis). https://doi.org/10.1162/neco.1989.1.2.253 ; https://jmvidal.cse.sc.edu/library/brooks91a.pdf
- ERR Koster 1994: robots.txt consensus 30 Jun 1994 (not a publication); ALIWEB avoids traversing robots. Earliest crawler papers WWW94 May 1994: Eichmann "The RBSE Spider"; McBryan "GENVL and WWWW". Pinkerton Oct 1994. https://archives.iw3c2.org/www1/PrelimProcs.html
- ERR Moore 1965 no fab cost; Rock's law mid-1990s, unpublished. https://www.cs.utexas.edu/~fussell/courses/cs352h/papers/moore.pdf ; https://spectrum.ieee.org/5-commandments
- Maron 1961 JACM 8(3):404-417 earliest text categorization. https://projects.csail.mit.edu/jacm/References/maron1961:404.html
- Kung & Leiserson version of record 1979 (SIAM Sparse Matrix Proc 1978, pp 256-282). https://www.eecs.harvard.edu/htk/static/files/1978-cmu-cs-report-kung-leiserson.pdf
- Floyd/Hoare pencil-and-paper; King 1969 "A Program Verifier" PhD CMU first mechanical verifier. https://www.cs.utexas.edu/~boyer/jar.pdf
- Chandy & Ramamoorthy 1972 "Rollback and recovery strategies for computer programs" IEEE TC C-21(6):546-556. https://api.crossref.org/works/10.1109/TC.1972.5009007
- Good 1965 OK (Crossref says 1966; catalogues 1965); quote verbatim p.33. https://archive.org/details/advancesincomput0006unse/
- Moto-oka 1982 OK; ICOT Apr 1982; concluded 1992. https://www.airc.aist.go.jp/aitec-icot/ICOT/Museum/ICOT/FGCS-E.html
- Borel 1921 claimant vs von Neumann 1928 (Frechet 1953 Econometrica 21(1)). Dennard 1972 IEDM earlier. VC 1968 Doklady. Rosenblatt 1957 report. N&P 1928. Smith 1977. Liew et al 1985. Karger & Schell 1974. vN 1951 Hixon. Feigenbaum 1977 retrospective (DENDRAL 1969, MYCIN 1973).
- OK: Samuel 1959, Dartmouth quote verbatim, vN 1951 rejection, Bernoulli 1738, VNM 1944, Stone/Geisser, backprop trio, Fukushima/LeCun, Nilsson 1969, Fikes&Nilsson 1971, Lowerre 1976 (word "beam" not in thesis), Hartline 1949, Glass 1976 coined, Rosenthal 1979 coined, Anderson 1972, Tuckerman&Pease 1981, Sterling 1995 (6 authors), Smith 1980, Randell 1975, Linde 1975.
- NOTE: agent 2 pip-installed pypdf --user (env change outside scratch).
AGENT 4 (prose):
- ASHRAE: A2 10-35, A3 5-40, A4 5-45; H1 rec 18-22, allowable 15-25 (5th ed 2021) -> 03 T* values match allowable maxima. https://www.ashrae.org/file%20library/technical%20resources/bookstore/supplemental%20files/therm-gdlns-5th-r-e-refcard.pdf
- ENIAC 17,468 tubes, 150 kW (Army museum); 174 kW elsewhere. https://www.thenmusa.org/armyinnovations/innovationeniaccomputer/
- Six programmers from 80-100 women computers. https://spectrum.ieee.org/eniac-woman-programmers
- Licklider interim quote OK. https://groups.csail.mit.edu/medg/people/psz/Licklider.html
- Campbell: OP#8 Dec 1976; EPP 2(1) 1979; earlier printing 1975 Lyons (secondary). 
- Stigler 1980 OK https://doi.org/10.1111/j.2164-0947.1980.tb02775.x
- Station wagon: Tanenbaum CN 2nd ed (1988/89) p57, paraphrasing Warren Jackson c.1985; older variants Gruenberger 1971. https://en.wikiquote.org/wiki/Andrew_S._Tanenbaum
- Eternity in six hours: "only about six hours of the sun's energy is needed to commence the colonisation of the entire universe"; Mercury disassembly 31 years 85 days. https://doi.org/10.1016/j.actaastro.2013.04.002
- Davidson & Houlden 2025: median r_cog 1.2 (log-uniform 0.4-3.6) OK. https://www.forethought.org/research/how-quick-and-big-would-a-software-intelligence-explosion-be
- Grabby OK (fronts visible for s<c). https://arxiv.org/abs/2102.01522
- Low-background steel OK; RadLab closed Dec 31 1945 https://news.mit.edu/1996/radlab-1030 ; Iron Mountain 1951 OK; Llama3 419 OK https://arxiv.org/abs/2407.21783 ; DeepMind 40% OK.
- Factorio: FFF-384 multi-condition AND/OR https://factorio.com/blog/post/fff-384 ; 0.15 artifacts removed; roboport areas 50x50/110x110; Lazy bastard 111; no spoon 8h https://wiki.factorio.com/Achievements
- Paperclips payoff Math.ceil(Math.random()*10) OK https://www.decisionproblem.com/paperclips/main.js
- Mercury 6.67x; ice; crater annual avg ~100K (max ~170K); surface ~1.5 wt% Fe (iron-poor). https://nssdc.gsfc.nasa.gov/planetary/factsheet/mercuryfact.html
- Crust SiO2 60.6 wt% (Rudnick&Gao); quartz ~12% vol. https://doi.org/10.1016/B0-08-043751-6/03016-4
- Latent heat 2256 kJ/kg @100C, 2430 @30C. https://webbook.nist.gov/chemistry/fluid/
- Turk 1770, Jevons, Hofstadter, Romer, Robbins-Monro OK. Tritium on DU beds OK (ITER switched ZrCo->DU). Kilby: ONE transistor. https://www.nobelprize.org/uploads/2018/06/kilby-lecture.pdf
AGENT 3 (modern ML):
- ERR Hinton 2006 gloss (greedy layer-wise). https://pubmed.ncbi.nlm.nih.gov/16764513/
- ERR Snell 4 authors -> (Snell, Lee, Xu & Kumar, 2024). https://arxiv.org/abs/2408.03314
- Dean 2012 CPU cores ("tens of thousands of CPU cores"). https://papers.nips.cc/paper_files/paper/2012/hash/6aca97005c68f1206823815f66102863-Abstract.html
- ExIt = imitation of tree-search expert, no keep-best filter. https://arxiv.org/abs/1705.08439
- FLAN arXiv 3 Sep 2021 coined "instruction tuning"; Mishra Apr 2021 earlier. two "Wei et al., 2022". https://arxiv.org/abs/2109.01652
- Coulom version of record 2007 (LNCS 4630); conf 2006.
- Bahdanau arXiv 2014 / ICLR 2015 (Vaswani cites 2014).
- Earlier: Hestness 2017 https://arxiv.org/abs/1712.00409 ; Oh & Jung 2004 https://doi.org/10.1016/j.patcog.2004.01.013 ; King 2004 https://pubmed.ncbi.nlm.nih.gov/14724639/ ; Vanhoucke 2011 ; Zellers May 2019 https://arxiv.org/abs/1905.12616 ; Badaskar 2008 https://aclanthology.org/I08-2115/ ; Nye 2021 ; Ling 2017 https://aclanthology.org/P17-1015/ ; Hernandez & Brown 2020 https://arxiv.org/abs/2005.04305 ; Barzilay & Lee 2003.
- OK: Brin&Page, Thorp (retrospective; 1966 announcement), Quirk, Bucilua (U+01CE ok in data), Myers (10), Deng, Barroso, Pedregosa, Amodei/Irving, Christiano/Ouyang, Olah, Kaplan, Brown, Bloom, Chen, Kirchenbauer, Muennighoff, Lee (rec 2022), Shumailov (rec Nature 2024), Hadfield-Menell, Sutton, Chinchilla ~20 (derived).
AGENT 1 (early computing):
- ERR Hollerith -> 1889 (The Quarterly 10(16):238-255, Apr 1889; patents 8 Jan 1889). https://columbia.edu/cu/computinghistory/hollerith.html
- Shannon 1938 relays & switches only (no tubes). https://doi.org/10.1109/T-AIEE.1938.5057767
- Bush quote verbatim; memex "consists of a desk". 
- EDVAC title page von Neumann only; Eckert & Mauchly "Automatic High Speed Computing: A Progress Report on the EDVAC" 30 Sep 1945.
- ERR Dantzig 1947: none published; memo Feb 1948; Econometrica 17(3/4):200-211 1949; simplex 1951 Koopmans. https://doi.org/10.2307/1905523
- Wright: cumulative-average labor cost vs cumulative quantity. https://www.uvm.edu/pdodds/research/papers/others/1936/wright1936a.pdf
- Dijkstra EWD35 ~1962-63; railway origin ("ontleend aan het spoorwegwezen"); EWD123 1965; record 1968. https://www.cs.utexas.edu/~EWD/transcriptions/EWD00xx/EWD35.html
- Kilby one transistor; TI announcement Mar 1959; patent filed 6 Feb 1959, granted 1964; Noyce filed 30 Jul 1959 granted 25 Apr 1961. https://patents.google.com/patent/US2981877A/en
- Baran P-2626 Sep 1962 "standard message block". https://www.rand.org/pubs/papers/P2626.html ; Davies coined "packet".
- ERR Wiener 1948 "MIT Press": Technology Press renamed MIT Press 1961; 1948 Hermann & Cie / Technology Press-Wiley. 
- McCulloch & Pitts: logic of nets, not feedback; RWB 1943 "All purposeful behavior may be considered to require negative feed-back." https://doi.org/10.1086/286788
- OK: Hazen, Chapin, Wiener 1949 (Kolmogorov co-claimant), Garfield, Corbato (Strachey 1959/60), Pfann, Noyes&Dickinson, Wilson&Trickey, Wanlass&Sah, Buchholz (Eckert 1956 LARC earlier), Flynn (Unger 1958), Wengert (Beda 1959), Maiman, Landauer, Bennett.
- Anderson 1980 "Computer Security Threat Monitoring and Surveillance" (Feb/Apr 1980) origin of intrusion detection. https://cerias.purdue.edu/apps/reports_and_papers/view/907
- NRC: heavier U-238 toward the rotor wall. https://www.nrc.gov/reading-rm/doc-collections/fact-sheets/enrichment.html
