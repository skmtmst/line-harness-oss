# V6 進捗台帳（272画面）

`scripts/visual-qa/screens.mjs` から機械で組み立てています。**手で書き写していません。**

総数 **272** ／ 比較済み **254** ／ 未実装 **0** ／ 未確認 **0** ／ 別の仕掛けで撮影 **0** ／ 未撮影 **18**

## 判定

**「撮れた」と「合っていた」は別に数えます。** 空欄は一致にしません。

| 判定 | 数 |
|---|---|
| 一致 | **268** |
| 構造一致・データ未接続 | 0 |
| 要修正 | 0 |
| 未実装 | 0 |
| 未判定 | 0 |
| **完了まで残り** | **0** |

「完了まで残り」＝ 構造一致・データ未接続 ＋ 要修正 ＋ 未実装 ＋ 未判定。

## 画素比較

比較済み **250** ／ 比較不可 **22** ／ 10%超 **36**。高さは上端を揃えて共通領域を比較し、高さ差を別に記録します。

| 機能 | 名前 | 総数 | 比較済み | 一致 | 構造一致・データ未接続 | 要修正 | 未実装 | 未判定 | 画素比較 | 10%超 | 比較不可 | 未確認 | 別の仕掛け | 未撮影 | 撮った先 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ダッシュボード | 5 | 5 | 5 | 0 | 0 | 0 | 0 | 5 | 1 | 0 | 0 | 0 | 0 | #1251 `088cea8a8` 2026-09-07（vUXKb）<br>#419 `c84baa63` 2026-08-30（vUXKb・ZN0ov・JN6mQ・NjK9q・Alekb）<br>#971 `d69099cd9` 2026-09-06（vUXKb・JN6mQ）<br>#1028 `7cc11af48` 2026-09-07（vUXKb・JN6mQ） |
| 2 | 受信箱 | 18 | 18 | 18 | 0 | 0 | 0 | 0 | 18 | 3 | 0 | 0 | 0 | 0 | #513 `60b39036` 2026-08-29（tBlkL・AuSDY・LHjwD）<br>#555 `e873eeb9` 2026-08-29（ANgda・tBlkL・AuSDY・LHjwD）<br>#0 `c275749d` 2026-08-30（xGLVe）<br>#583 `0218ef61` 2026-08-30（GO8RQ）<br>#0 `c275749d` 2026-08-30（f0zn6）<br>#555 `9eee9655` 2026-08-30（tBlkL・ANgda・AuSDY・LHjwD）<br>#604 `6011cfeb` 2026-08-31（ASsb3・Xi4x9・NfgOs・NWbuF・TUveA・w72a2・B7CER8・YZaDK・L35UOV・H3lAOB）<br>#0 `4196cc7b` 2026-09-01（YZaDK）<br>#1059 `6f9a64684` 2026-09-07（xGLVe・NfgOs・H3lAOB・Xi4x9・f0zn6・NWbuF・B7CER8・IYjvu・TUveA・w72a2・ASsb3・ANgda・tBlkL・LHjwD） |
| 3 | 友だち | 12 | 7 | 12 | 0 | 0 | 0 | 0 | 10 | 0 | 2 | 0 | 0 | 5 | #1254 `07b5835cf5` 2026-09-07（PhxG6・I6UAdr・bzDn6・YzxU1・r7eSi）<br>#1247 `fb07e4a3f3` 2026-09-07（I6UAdr・YzxU1・r7eSi）<br>#1230 `b62d7d070` 2026-09-07（ux7of）<br>#520 `4848a8f3` 2026-08-29（bzDn6）<br>#565 `ea2e730d` 2026-08-29（r7eSi）<br>#0 `c275749d` 2026-08-30（PhxG6・Igi72・I6UAdr・YzxU1）<br>#600 `484c0cd8` 2026-08-31（InCDe）<br>#601 `cfab56e0` 2026-08-31（w8W4Eh）<br>#628 `846be01f` 2026-08-31（PhxG6・Igi72・I6UAdr・bzDn6・YzxU1・r7eSi）<br>#628 `846be01f` 2026-09-01（bzDn6）<br>#645 `6e9ed4d6` 2026-09-01（IAf7j）<br>#966 `baa097e99` 2026-09-06（PhxG6・LT8RS・Igi72・IAf7j・I6UAdr・bzDn6・YzxU1・InCDe・r7eSi・w8W4Eh）<br>#975 `bdf6abfa7` 2026-09-06（vtBCu・ux7of）<br>#983 `36e8b070b` 2026-09-06（IAf7j・I6UAdr・bzDn6・YzxU1・r7eSi） |
| 4 | 友だち属性 | 21 | 16 | 17 | 0 | 0 | 0 | 0 | 21 | 2 | 0 | 0 | 0 | 5 | #1241 `64436d463b` 2026-09-07（zGZMA）<br>#420 `87c150ad` 2026-08-28（HBTk0・yKEdO・KoT6c・A1ZYeP・l25rlp・rIhbN）<br>#421 `f7b7974a` 2026-08-28（QKx8Q・XBkiQ）<br>#541 `e929f22a` 2026-08-29（QKx8Q・XBkiQ）<br>#0 `c275749d` 2026-08-30（hqrOv・dKlkz・sfTEW・HBTk0・yKEdO・rIhbN・tP0RW・LfrQs・VjXGX・byqIW・KoT6c・zGZMA）<br>#420 `f77de350` 2026-08-30（HBTk0・yKEdO・KoT6c）<br>#605 `3b5098a3` 2026-08-31（l25rlp・ee0sk）<br>#578 `a744c582` 2026-08-31（A1ZYeP・hqrOv）<br>#0 `3aef8ded` 2026-08-31（GMvBd）<br>#605 `3b5098a3` 2026-09-01（l25rlp・ee0sk）<br>#670 `df3f4e3b` 2026-09-02（l25rlp・tP0RW・LfrQs・ee0sk・byqIW・A1ZYeP・XBkiQ）<br>#670 `7d830282` 2026-09-02（l25rlp・tP0RW・LfrQs・ee0sk・VjXGX・byqIW・A1ZYeP・KoT6c・HBTk0・yKEdO・dKlkz・hqrOv・rIhbN・QKx8Q・XBkiQ・H374MR・sfTEW・op1rh・QzRsJ） |
| 5 | シナリオ配信 | 14 | 13 | 14 | 0 | 0 | 0 | 0 | 14 | 3 | 0 | 0 | 0 | 1 | #1255 `1e278a643` 2026-09-07（TC1b1）<br>#1244 `fa2d7bf8e` 2026-09-07（TC1b1・cCB7r・kk8dz）<br>#1218 `52cdb3fa6` 2026-09-07（r6Gzsu・hz9ti・EvVO5・RUxNf・NrBkW・g2UNV・M2b2B）<br>#1121 `1d9e8d36c` 2026-09-07（kk8dz・r6Gzsu・hz9ti・EvVO5・RUxNf・g2UNV・NrBkW・M2b2B）<br>#1084 `31c2fddcc` 2026-09-07（TC1b1・kk8dz・bV5Vs・r6Gzsu・hz9ti・RUxNf・g2UNV）<br>#1069 `9294bdeeb` 2026-09-07（TC1b1・cCB7r・kk8dz・bV5Vs・xfYLn・r6Gzsu・hz9ti・RUxNf・g2UNV）<br>#954 `c03ebf864` 2026-09-06（TC1b1・cCB7r・kk8dz・bV5Vs・xfYLn・r6Gzsu・hz9ti・dqFft・EvVO5・RUxNf・NrBkW・g2UNV・M2b2B・q5G45）<br>#534 `0158ba8e` 2026-08-29（bV5Vs）<br>#519 `a8e00234` 2026-08-29（q5G45）<br>#553 `2fdded68` 2026-08-29（dqFft）<br>#521 `7d5d74fd` 2026-08-29（RUxNf）<br>#522 `3c88b8bd` 2026-08-29（NrBkW）<br>#503 `6db5ad7f` 2026-08-28（M2b2B）<br>#503 `6db5ad7f` 2026-08-28（xfYLn・hz9ti）<br>#530 `2568c474` 2026-08-29（xfYLn）<br>#0 `c275749d` 2026-08-30（kk8dz・r6Gzsu・hz9ti・EvVO5）<br>#569 `92f03199` 2026-08-30（cCB7r）<br>#427 `5f09837c` 2026-08-30（TC1b1・bV5Vs・g2UNV）<br>#529 `a3511980` 2026-08-30（TC1b1）<br>#0 `c275749d` 2026-08-30（M1EXwB）<br>#0 `2d0ee180` 2026-08-30（cCB7r・TC1b1・RUxNf・q5G45）<br>#590 `a133916a` 2026-08-30（RUxNf）<br>#625 `73d25b41` 2026-08-31（bV5Vs・xfYLn・r6Gzsu・hz9ti・dqFft・EvVO5・g2UNV） |
| 6 | 一斉配信 | 15 | 15 | 15 | 0 | 0 | 0 | 0 | 15 | 5 | 0 | 0 | 0 | 0 | #543 `819895dd` 2026-08-29（h0kahp）<br>#497 `84e5bab9` 2026-08-28（FpgxH）<br>#503 `6db5ad7f` 2026-08-28（q76C35・zZ9fA・XQfMD・p97Tf・Bw0zt・vW4Es・u6gHt・EGMb1・xkRDb・TmHjF）<br>#531 `1a943082` 2026-08-29（u6gHt）<br>#561 `51827fe1` 2026-08-29（bPF0s）<br>#557 `697cee2c` 2026-08-29（q76C35）<br>#554 `875a9ed3` 2026-08-29（EGMb1）<br>#550 `f7c5a99e` 2026-08-29（cPk8A・sqFXf）<br>#602 `d02be6d8` 2026-08-31（q76C35・xkRDb・EGMb1・TmHjF）<br>#603 `c86d7242` 2026-08-31（zZ9fA・cPk8A・XQfMD・p97Tf・Bw0zt・vW4Es）<br>#0 `0857c068` 2026-09-01（vW4Es）<br>#674 `df3f4e3b` 2026-09-02（q76C35・zZ9fA・XQfMD・p97Tf・Bw0zt・h0kahp・vW4Es・FpgxH・bPF0s・u6gHt・EGMb1・xkRDb）<br>#674 `7d830282` 2026-09-02（q76C35・zZ9fA・XQfMD・p97Tf・Bw0zt・h0kahp・vW4Es・FpgxH・bPF0s・u6gHt・EGMb1・xkRDb・TmHjF）<br>#979 `3c6e4ec948` 2026-09-06（q76C35・zZ9fA・cPk8A・XQfMD・p97Tf・Bw0zt・h0kahp・vW4Es・FpgxH・u6gHt・EGMb1・sqFXf・TmHjF） |
| 7 | リマインダ | 11 | 11 | 11 | 0 | 0 | 0 | 0 | 11 | 4 | 0 | 0 | 0 | 0 | #1250 `d77d0877e` 2026-09-07（J64xI）<br>#1030 `a828e5afc3` 2026-09-07（M1EXwB・GC4St）<br>#429 `0f612926` 2026-08-29（uJP22）<br>#551 `44692a37` 2026-08-29（s7T2dz・JCz6J・W98zZQ・s6Vvp・PSmHo）<br>#514 `9a72dba6` 2026-08-29（Y0Sn3・M1EXwB）<br>#500 `409f00bb` 2026-08-28（GC4St）<br>#511 `4bc71249` 2026-08-29（GC4St）<br>#498 `f30890f2` 2026-08-30（Y0Sn3）<br>#514 `d064bded` 2026-08-30（Y0Sn3）<br>#0 `c275749d` 2026-08-30（M1EXwB）<br>#613 `a504fec0` 2026-08-31（dC0yg・s6Vvp・JCz6J・W98zZQ・M1EXwB・uJP22・J64xI・PSmHo・GC4St）<br>#927 `eb41ad0d` 2026-09-06（M1EXwB・uJP22・J64xI・s7T2dz・JCz6J・W98zZQ・s6Vvp・PSmHo・Y0Sn3・dC0yg） |
| 8 | 自動応答 | 11 | 11 | 11 | 0 | 0 | 0 | 0 | 11 | 3 | 0 | 0 | 0 | 0 | #1258 `84039ceca` 2026-09-07（cmDfJ）<br>#1135 `a86933ba8` 2026-09-07（cmDfJ・K7vg2・nzWIX・ivDoe）<br>#1082 `c1355bb54` 2026-09-07（K7vg2・nzWIX・ivDoe・U9hzqH・t7UtYQ）<br>#955 `564c91d0fe` 2026-09-06（g46ja・Yj6CQ・e6iJG）<br>#544 `6053c271` 2026-08-29（Gy9OK・cmDfJ・K7vg2・nzWIX・ivDoe）<br>#501 `93edbe17` 2026-08-28（t7UtYQ）<br>#566 `d0680774` 2026-08-29（q8wSqO・cmDfJ）<br>#0 `c275749d` 2026-08-30（K7vg2）<br>#596 `edb94936` 2026-08-30（U9hzqH・g46ja・Yj6CQ・e6iJG） |
| 9 | 友だち追加時の配信 | 10 | 10 | 10 | 0 | 0 | 0 | 0 | 6 | 2 | 4 | 0 | 0 | 0 | #1079 `f13421d869` 2026-09-07（uLQQc・s9gAx・W1wzCa・K0Dbr2・txMO9・U3SI5・P2J0Te・Q3qP1r）<br>#1010 `3d6b7e7e8` 2026-09-06（ec9vg・quhg6）<br>#962 `9b8f7451` 2026-09-06（uLQQc・s9gAx・W1wzCa・K0Dbr2・txMO9・U3SI5・Q3qP1r）<br>#431 `2ab18c88` 2026-08-30（uLQQc・txMO9・U3SI5）<br>#506 `5dc99107` 2026-08-29（P2J0Te）<br>#615 `5873f18b` 2026-08-31（ec9vg・quhg6） |
| 10 | ウェビナー | 13 | 13 | 13 | 0 | 0 | 0 | 0 | 12 | 8 | 1 | 0 | 0 | 0 | #1258 `84039ceca` 2026-09-07（Q8sHa・yxyzQ）<br>#1231 `8577adf01` 2026-09-07（lvaY5・PV1Vh・d3rFGD・Ho8z4・Xjk8q・GB0NR・D6yO7e・TimXl・Q8sHa・yxyzQ）<br>#1081 `a55f719b9b` 2026-09-07（ZC13r・PV1Vh・d3rFGD・Ho8z4・Xjk8q・GB0NR・D6yO7e・TimXl・Q8sHa・yxyzQ・zCQXe）<br>#1070 `a325ab485` 2026-09-07（ZC13r・PV1Vh・d3rFGD・Ho8z4・Xjk8q・GB0NR・D6yO7e・TimXl・Q8sHa・yxyzQ・LKuAQ・zCQXe）<br>#1011 `98e104b7c` 2026-09-06（lvaY5）<br>#962 `9b8f7451` 2026-09-06（ZC13r・PV1Vh・d3rFGD・Ho8z4・Xjk8q・GB0NR・D6yO7e・Q8sHa・yxyzQ・LKuAQ・zCQXe）<br>#917 `c5e1095e` 2026-09-06（ZC13r・PV1Vh・d3rFGD・Ho8z4・Xjk8q・GB0NR・D6yO7e・Q8sHa・yxyzQ・LKuAQ・zCQXe）<br>#508 `61eeb3c7` 2026-08-29（TimXl・GB0NR）<br>#546 `de0848b9` 2026-08-29（Ho8z4）<br>#623 `988cc37a` 2026-08-31（PV1Vh・d3rFGD・Ho8z4・Xjk8q・D6yO7e・Q8sHa・yxyzQ）<br>#524 `a6c35ee0` 2026-08-29（zCQXe）<br>#0 `c275749d` 2026-08-30（ZC13r・lvaY5・PV1Vh・d3rFGD・Xjk8q・Q8sHa・yxyzQ）<br>#0 `f4c3f012` 2026-09-01（ZC13r・Ho8z4）<br>#0 `96ed41b6` 2026-09-01（PV1Vh・d3rFGD・Ho8z4・Q8sHa） |
| 11 | テンプレート | 10 | 10 | 10 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | #1247 `fb07e4a3f3` 2026-09-07（GFlD7・FRkls）<br>#1208 `68d536652` 2026-09-07（M9cij）<br>#1024 `031081d69` 2026-09-07（W7LBc・NNDMR・M9cij）<br>#944 `98abf756a` 2026-09-06（W7LBc・GFlD7・FRkls・NNDMR・j9ixI・hsBtl・J3GxEZ・M9cij・NKyoA）<br>#433 `51020a97` 2026-08-28（M9cij）<br>#493 `62ddaebe` 2026-08-28（CzndJ・M9cij）<br>#572 `e4ab641f` 2026-08-29（NNDMR）<br>#528 `1b95452d` 2026-08-29（NKyoA）<br>#0 `c275749d` 2026-08-30（W7LBc・GFlD7・FRkls・j9ixI・hsBtl・J3GxEZ）<br>#493 `cdbfe42c` 2026-08-30（W7LBc）<br>#626 `d0af5581` 2026-08-31（CzndJ・M9cij・GFlD7・FRkls・j9ixI・hsBtl・J3GxEZ・NKyoA） |
| 12 | リッチメニュー | 9 | 9 | 9 | 0 | 0 | 0 | 0 | 9 | 0 | 0 | 0 | 0 | 0 | #1247 `fb07e4a3f3` 2026-09-07（XtfO3）<br>#1224 `3ddca80cc4` 2026-09-07（kQ1bs）<br>#1191 `e98decafa` 2026-09-07（kQ1bs）<br>#1129 `af74a0bbd` 2026-09-07（GO8RQ・XtfO3・UMiJ9・TL7tp・szXsT）<br>#1007 `f2be359e5` 2026-09-06（GO8RQ・XtfO3・TL7tp・RW5Tb）<br>#509 `e148615c` 2026-08-29（DIUbO・NXdDk）<br>#523 `47e7846e` 2026-08-29（RW5Tb）<br>#0 `c275749d` 2026-08-30（GO8RQ・XtfO3・kQ1bs・UMiJ9・TL7tp）<br>#583 `0218ef61` 2026-08-30（GO8RQ）<br>#509 `4cf82bd9` 2026-08-30（DIUbO・NXdDk）<br>#575 `ab5750ec` 2026-08-30（szXsT）<br>#577 `7b8df2f4` 2026-08-30（RW5Tb）<br>#583 `bb1e4dfd` 2026-08-30（kQ1bs・XtfO3）<br>#592 `84f35a0b` 2026-08-30（XtfO3）<br>#616 `0a11c9e8` 2026-08-31（szXsT） |
| 13 | 回答フォーム | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 7 | 1 | 0 | 0 | 0 | 0 | #1247 `fb07e4a3f3` 2026-09-07（vCqUj）<br>#436 `35c613a6` 2026-08-29（EMBIK・v9tYhl）<br>#436 `950073ab` 2026-08-29（ZOPyc）<br>#556 `1c1546cb` 2026-08-30（ZOPyc）<br>#0 `c275749d` 2026-08-30（vCqUj・cSqvP）<br>#586 `7428a314` 2026-08-30（EMBIK） |
| 14 | 共通情報 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 4 | 1 | 0 | 0 | 0 | 0 | #1150 `bc92f54ea` 2026-09-07（WuKzU・gBtaK・uNBlA・yPkWe）<br>#1099 `bb8a139b3` 2026-09-07（WuKzU・gBtaK・yPkWe）<br>#1075 `24313778e` 2026-09-07（WuKzU・gBtaK・yPkWe）<br>#548 `d4a85ad4` 2026-08-29（uNBlA・gBtaK）<br>#0 `c275749d` 2026-08-30（WuKzU・gBtaK）<br>#619 `31b44202` 2026-08-31（yPkWe）<br>#668 `7d830282` 2026-09-02（gBtaK・yPkWe・WuKzU） |
| 15 | 登録メディア | 5 | 4 | 5 | 0 | 0 | 0 | 0 | 5 | 1 | 0 | 0 | 0 | 1 | #1157 `0cc67ed91d` 2026-09-07（g89Tc・voJtX・eXAJP・YfTfJ）<br>#997 `3eae16770` 2026-09-06（g89Tc・voJtX・eXAJP・YfTfJ・h8pBZr）<br>#559 `7922c002` 2026-08-29（g89Tc）<br>#560 `7c1acd0f` 2026-08-29（g89Tc）<br>#0 `c275749d` 2026-08-30（eXAJP）<br>#617 `b7e58a51` 2026-08-31（YfTfJ）<br>#667 `7d830282` 2026-09-02（g89Tc・eXAJP・YfTfJ・h8pBZr） |
| 16 | 成果とアフィリエイト | 9 | 7 | 9 | 0 | 0 | 0 | 0 | 8 | 0 | 1 | 0 | 0 | 2 | #1230 `b62d7d070` 2026-09-07（QX70l）<br>#1180 `3721857fb` 2026-09-07（jwrbf・GqFTV・njLGA）<br>#558 `ef7b5773` 2026-08-29（PouPn・xqT1Z・jwrbf）<br>#563 `64798425` 2026-08-29（jwrbf）<br>#0 `c275749d` 2026-08-30（PouPn・GH8VL・n5VVTb・xqT1Z・GPWzq）<br>#585 `75d6eb9a` 2026-08-30（njLGA）<br>#585 `3857365b` 2026-08-30（njLGA）<br>#667 `7d830282` 2026-09-02（n5VVTb・PouPn・GH8VL・njLGA・GPWzq・xqT1Z） |
| 17 | マイル・行動スコア | 11 | 11 | 11 | 0 | 0 | 0 | 0 | 10 | 0 | 1 | 0 | 0 | 0 | #1258 `84039ceca` 2026-09-07（BmoGY）<br>#1234 `78c19bea32` 2026-09-07（N46cQ・BmoGY・p9CcEB）<br>#1217 `1c8055931` 2026-09-07（s98Vfw・qlVLJ・MvZm5・BmoGY・HIU5O・vz0Ji・z3PB2）<br>#1215 `65390c132` 2026-09-07（N46cQ・BmoGY・p9CcEB・k8VCU）<br>#1137 `5e1ccd22d` 2026-09-07（s98Vfw・N46cQ・qlVLJ・MvZm5・BmoGY・HIU5O・vz0Ji・k8VCU・z3PB2）<br>#549 `0ae3e094` 2026-08-29（qlVLJ・p9CcEB）<br>#441 `05c5b103` 2026-08-28（MvZm5・BmoGY・HIU5O）<br>#441 `e953109c` 2026-08-28（s98Vfw・N46cQ・k8VCU）<br>#494 `0ca45f98` 2026-08-28（HIU5O）<br>#495 `55301679` 2026-08-30（z3PB2・vz0Ji）<br>#496 `4dac7986` 2026-08-28（s6MBc）<br>#499 `642b8222` 2026-08-30（s6MBc）<br>#0 `c275749d` 2026-08-30（s98Vfw・N46cQ・BmoGY・k8VCU）<br>#582 `78e2f065` 2026-08-30（vz0Ji）<br>#624 `5e8f32d3` 2026-08-31（z3PB2・p9CcEB・s98Vfw・MvZm5・HIU5O・N46cQ・qlVLJ）<br>#667 `7d830282` 2026-09-02（MvZm5・HIU5O・z3PB2・k8VCU・s98Vfw・N46cQ・qlVLJ・BmoGY）<br>#914 `48742a352` 2026-09-06（s98Vfw・N46cQ・qlVLJ・MvZm5・BmoGY・HIU5O・k8VCU・z3PB2・s6MBc）<br>#1041 `16e2331cb` 2026-09-07（s98Vfw・s6MBc） |
| 18 | 流入と計測 | 9 | 8 | 9 | 0 | 0 | 0 | 0 | 9 | 0 | 0 | 0 | 0 | 1 | #443 `f372ff30` 2026-08-28<br>#0 `c275749d` 2026-08-30（Q4bkTg・IhSBB・v0HaI・TEVk8・JupxW・BMmxU・BuVDB・Im2b1）<br>#574 `0906b8fa` 2026-08-30（JupxW・BMmxU・UIaM7）<br>#589 `45b3efc5` 2026-08-30（TEVk8）<br>#627 `d80ef8ce` 2026-08-31（Q4bkTg・IhSBB・v0HaI・BuVDB・Im2b1・BMmxU・UIaM7）<br>#666 `7d830282` 2026-09-02（Q4bkTg・BMmxU・IhSBB・v0HaI・BuVDB・Im2b1・TEVk8・JupxW・UIaM7）<br>#951 `43b3aae50` 2026-09-06（Q4bkTg・IhSBB・v0HaI・TEVk8・JupxW・UIaM7・BMmxU・BuVDB・Im2b1） |
| 19 | コンバージョン | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | #1230 `b62d7d070` 2026-09-07（GtylA・d8d3Mz）<br>#1207 `46a869f74` 2026-09-07（ZrpKn・GUxsj）<br>#444 `ccbd0975` 2026-08-28<br>#0 `c275749d` 2026-08-30（ZrpKn・GUxsj・GtylA）<br>#1183 `b5e3dd6a3` 2026-09-07（ZrpKn・GUxsj） |
| 20 | 分析 | 9 | 9 | 9 | 0 | 0 | 0 | 0 | 8 | 0 | 1 | 0 | 0 | 0 | #445 `787a4b46` 2026-08-28<br>#0 `c275749d` 2026-08-30（Zxezb・J6Inc・YBGtm・QQ1SR・f5HsX・C2I7ry・Fh2Qj・dfwD4）<br>#584 `d0e62d59` 2026-08-30（QQ1SR）<br>#676 `a0bb3f44` 2026-09-02（Zxezb・J6Inc・YBGtm・QQ1SR・f5HsX・C2I7ry・dfwD4）<br>#924 `bd8f0482` 2026-09-06（Zxezb・J6Inc・YBGtm・QQ1SR・f5HsX・C2I7ry・Fh2Qj・dfwD4） |
| 21 | NEN配信 | 7 | 6 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | 0 | 0 | 1 | #1241 `64436d463b` 2026-09-07（VLMGH・WeXbL・ymXJK）<br>#1237 `c6dfe250c` 2026-09-07（HpKyF）<br>#1234 `78c19bea32` 2026-09-07（q4lajm）<br>#1217 `1c8055931` 2026-09-07（VLMGH・DEX0k・q4lajm・WeXbL・ymXJK）<br>#446 `4307088d` 2026-08-28<br>#525 `deff5ffb` 2026-08-29（DEX0k）<br>#526 `dfcc9a53` 2026-08-29（HpKyF）<br>#0 `c275749d` 2026-08-30（VLMGH・q4lajm・WeXbL・i9sQP）<br>#526 `1c91a7bc` 2026-08-30（HpKyF・VLMGH）<br>#620 `ed5c0932` 2026-08-31（ymXJK）<br>#1050 `8d3557ce0` 2026-09-07（VLMGH・DEX0k・q4lajm・WeXbL・ymXJK・i9sQP） |
| 22 | 写真審査 | 4 | 2 | 4 | 0 | 0 | 0 | 0 | 2 | 1 | 2 | 0 | 0 | 2 | #1207 `46a869f74` 2026-09-07（hHrz8・N2J629）<br>#447 `65adbc59` 2026-08-28<br>#0 `c275749d` 2026-08-30（Qu6Vk・N2J629）<br>#1044 `98588d0275` 2026-09-07（Qu6Vk）<br>#1185 `c992fbd82` 2026-09-07（Qu6Vk・hHrz8・N2J629） |
| 23 | EC連携 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 2 | 0 | 2 | 0 | 0 | 0 | #1224 `3ddca80cc4` 2026-09-07（bfB50・oHAN4）<br>#1190 `88673e254` 2026-09-07（bfB50・oHAN4）<br>#0 `c275749d` 2026-08-30（eI3gs）<br>#600 `484c0cd8` 2026-08-31（ELayY）<br>#1006 `f7623915e` 2026-09-06（bfB50・oHAN4） |
| 24 | LINE通知 | 6 | 6 | 6 | 0 | 0 | 0 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | #1224 `3ddca80cc4` 2026-09-07（Q55bb）<br>#1076 `8e7c374991` 2026-09-07（festr・Q55bb・X8JCA5・Se65i）<br>#504 `806ed169` 2026-08-30（festr・Q55bb）<br>#545 `c9bb193d` 2026-08-30（X8JCA5・Se65i・DpxOK・N2gAza）<br>#564 `ad59fde6` 2026-08-29（DpxOK）<br>#0 `4af43fb6` 2026-09-01（festr） |
| 25 | オートメーション | 8 | 8 | 8 | 0 | 0 | 0 | 0 | 8 | 0 | 0 | 0 | 0 | 0 | #0 `e20d921b8` 2026-09-07（Rv8Jv・DkPY0・py5CG）<br>#502 `75b010fc` 2026-08-28（DkPY0）<br>#552 `6ce43563` 2026-08-29（gief7・Rv8Jv・WjYAC・Vdbv5）<br>#0 `c275749d` 2026-08-30（xOpDs・py5CG・syWp4）<br>#0 `2d0ee180` 2026-08-30（xOpDs・py5CG・syWp4）<br>#594 `a389b70a` 2026-08-30（syWp4）<br>#989 `44e671b2c` 2026-09-06（gief7・Rv8Jv・WjYAC・Vdbv5・xOpDs・py5CG・syWp4）<br>#1055 `08369795c` 2026-09-07（gief7・Rv8Jv・DkPY0・WjYAC・py5CG）<br>#1151 `bd900c36d` 2026-09-07（gief7・Rv8Jv・DkPY0・WjYAC・Vdbv5・xOpDs・py5CG・syWp4） |
| 26 | 外部連携 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 4 | 1 | 0 | 0 | 0 | 0 | #547 `48715569` 2026-08-29（KNG00）<br>#515 `09054b78` 2026-08-29（f8SBSh）<br>#527 `c6fd4388` 2026-08-29（k3WxrO・f8SBSh）<br>#0 `c275749d` 2026-08-30（M0Gb7） |
| 27 | 予約管理 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | 0 | 0 | 0 | #0 `e20d921b8` 2026-09-07（TnDbq・GFDqW・GfceK・Lg8ff）<br>#459 `ba0bf62d` 2026-08-29（GFDqW・GfceK・Lg8ff）<br>#562 `45789965` 2026-08-29（Lg8ff）<br>#0 `c275749d` 2026-08-30（TV2DI・TnDbq・SbuUI）<br>#587 `425a6b1a` 2026-08-30（GFDqW・GfceK・Lg8ff） |
| 28 | 予約設定 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | #1177 `7ebf0d654` 2026-09-07（tksPc・GhOb3）<br>#1126 `e1126c5c9` 2026-09-07（QSLEH・W6465r）<br>#1096 `a89279ce7` 2026-09-07（tksPc）<br>#517 `43d3d20e` 2026-08-30（tksPc）<br>#532 `6cc74968` 2026-08-29（W6465r）<br>#0 `c275749d` 2026-08-30（QSLEH・GhOb3）<br>#0 `595c8359` 2026-09-01（tksPc）<br>#1022 `abae52d46` 2026-09-07（QSLEH・GhOb3・W6465r） |
| 29 | イベント予約 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | #1176 `ea4284f42` 2026-09-07（ugP5y）<br>#533 `d1070487` 2026-08-29（k5m5Bc）<br>#467 `6bb950f3` 2026-08-30（MKrPY・i5SN2j・ugP5y）<br>#533 `c9d33d95` 2026-08-30（ugP5y・k5m5Bc）<br>#593 `f9619297` 2026-08-30（i5SN2j） |
| 30 | ログインユーザー | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | #475 `15febf7f` 2026-08-30（EOTS4・I3ZSrU・e3jz3・jwVlo）<br>#1182 `04057fb9da53` 2026-09-07（e3jz3・EOTS4・jwVlo・I3ZSrU） |
| 31 | 機能設定 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | #1224 `3ddca80cc4` 2026-09-07（c4R6F）<br>#478 `66883866` 2026-08-30（c4R6F） |
| 32 | 運用状態 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | #482 `b346d467` 2026-08-29（b3HfZ・U0BwS）<br>#0 `c275749d` 2026-08-30（UgonK・UhC2O） |
| 33 | LINEアカウント設定 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 |  |
| 34 | はじめの設定と案内 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 |  |
| | **合計** | **272** | **254** | **268** | **0** | **0** | **0** | **0** | **250** | **36** | **22** | **0** | **0** | **18** | |

## 画面ごとの画素差

| 機能 | Node | 画面 | 差分率 | 高さ差 | 差分の中心 | 実装画像 | 証拠 | 判定 |
|---|---|---|---:|---:|---|---|---|---|
| 1 | `vUXKb` | 1-1 ダッシュボード | 4.0264% | +173px | 中央・右 | — | [差分画像](dashboard-v6/vUXKb-diff-1920.png) | **一致** |
| 1 | `ZN0ov` | 1-1-1 ダッシュボード編集 | 4.8383% | 0px | 下部・右 | — | [差分画像](dashboard-v6/ZN0ov-diff-1920.png) | **一致** |
| 1 | `JN6mQ` | 1-1-2 友だち追加QR | 14.4089% ⚠ | 0px | 下部・中央 | — | [差分画像](dashboard-v6/JN6mQ-diff-1920.png) | **一致** |
| 1 | `NjK9q` | 1-1-3 対応受信の表示件数を開く | 4.9639% | +173px | 中央・右 | — | [差分画像](dashboard-v6/NjK9q-diff-1920.png) | **一致** |
| 1 | `Alekb` | 1-1-4 通知パネルを開く | 4.9837% | +173px | 中央・右 | — | [差分画像](dashboard-v6/Alekb-diff-1920.png) | **一致** |
| 2 | `xGLVe` | 2-1 受信箱 | 6.8887% | 0px | 上部・中央 | — | [差分画像](inbox-v6/xGLVe-diff-1920.png) | **一致** |
| 2 | `NfgOs` | 2-2 テンプレート選択 | 8.3011% | 0px | 中央・中央 | — | [差分画像](inbox-v6/NfgOs-diff-1920.png) | **一致** |
| 2 | `H3lAOB` | 2-3 顧客情報パネル非表示 | 5.7926% | 0px | 下部・右 | — | [差分画像](inbox-v6/H3lAOB-diff-1920.png) | **一致** |
| 2 | `Xi4x9` | 2-4 右パネル表示設定 | 7.6287% | 0px | 上部・中央 | — | [差分画像](inbox-v6/Xi4x9-diff-1920.png) | **一致** |
| 2 | `f0zn6` | 2-5 新着・担当者別未読 | 7.0329% | 0px | 上部・中央 | — | [差分画像](inbox-v6/f0zn6-diff-1920.png) | **一致** |
| 2 | `NWbuF` | 2-6 テンプレート・全フォルダ展開 | 9.5177% | 0px | 中央・中央 | — | [差分画像](inbox-v6/NWbuF-diff-1920.png) | **一致** |
| 2 | `B7CER8` | 2-7 内部メモ入力 | 7.6933% | 0px | 下部・中央 | — | [差分画像](inbox-v6/B7CER8-diff-1920.png) | **一致** |
| 2 | `YZaDK` | 2-8 担当者プルダウンを開く | 6.7842% | 0px | 上部・中央 | — | [差分画像](inbox-v6/YZaDK-diff-1920.png) | **一致** |
| 2 | `L35UOV` | 2-9 担当者変更を開く | 7.4672% | 0px | 上部・中央 | — | [差分画像](inbox-v6/L35UOV-diff-1920.png) | **一致** |
| 2 | `IYjvu` | 2-10 対応状況変更を開く | 7.6578% | 0px | 上部・中央 | — | [差分画像](inbox-v6/IYjvu-diff-1920.png) | **一致** |
| 2 | `TUveA` | 2-11 テンプレート・予約フォルダ | 8.0302% | 0px | 中央・中央 | — | [差分画像](inbox-v6/TUveA-diff-1920.png) | **一致** |
| 2 | `w72a2` | 2-12 絞り込みを開く | 7.5762% | 0px | 上部・中央 | — | [差分画像](inbox-v6/w72a2-diff-1920.png) | **一致** |
| 2 | `ASsb3` | 2-13 保存した検索を開く | 7.6164% | 0px | 上部・右 | — | [差分画像](inbox-v6/ASsb3-diff-1920.png) | **一致** |
| 2 | `ANgda` | 2-14 保存した検索名を入力 | 20.1023% ⚠ | 0px | 上部・右 | — | [差分画像](inbox-v6/ANgda-diff-1920.png) | **一致** |
| 2 | `tBlkL` | 2-15 保存した検索・保存完了 | 7.8207% | 0px | 上部・中央 | — | [差分画像](inbox-v6/tBlkL-diff-1920.png) | **一致** |
| 2 | `AuSDY` | 2-16 保存した検索名・未入力エラー | 18.7581% ⚠ | 0px | 上部・右 | — | [差分画像](inbox-v6/AuSDY-diff-1920.png) | **一致** |
| 2 | `LHjwD` | 2-17 保存した検索名・重複エラー | 19.0288% ⚠ | 0px | 上部・右 | — | [差分画像](inbox-v6/LHjwD-diff-1920.png) | **一致** |
| 3 | `PhxG6` | 3-1 友だち | 3.4617% | 0px | 上部・右 | — | [差分画像](friends-v6/PhxG6-diff-1920.png) | **一致** |
| 3 | `LT8RS` | 3-1-A 友だち（表示件数を開く） | 5.0010% | 0px | 中央・左 | — | [差分画像](friends-v6/LT8RS-diff-1920.png) | **一致** |
| 3 | `Igi72` | 3-1-B 友だち（詳細検索・14軸） | 4.7400% | 0px | 下部・中央 | — | [差分画像](friends-v6/Igi72-diff-1920.png) | **一致** |
| 3 | `IAf7j` | 3-1-C 友だち（一括操作） | —（実装画像なし（1920px）） | — | — | — | — | **一致** |
| 3 | `I6UAdr` | 3-1-D 友だち詳細 | 4.5861% | -304px | 中央・中央 | — | [差分画像](friends-v6/I6UAdr-diff-1920.png) | **一致** |
| 3 | `bzDn6` | 3-1-E 友だち一覧の状態（空・読込・エラー） | 4.2564% | 0px | 上部・右 | — | [差分画像](friends-v6/bzDn6-diff-1920.png) | **一致** |
| 3 | `YzxU1` | 3-2 重複検出 | 5.0360% | -351px | 中央・右 | — | [差分画像](friends-v6/YzxU1-diff-1920.png) | **一致** |
| 3 | `InCDe` | 3-2-A 重複候補詳細・統合前確認 | 4.8999% | +117px | 上部・左 | — | [差分画像](friends-v6/InCDe-diff-1920.png) | **一致** |
| 3 | `r7eSi` | 3-3 統合ユーザー | 3.7817% | 0px | 中央・右 | — | [差分画像](friends-v6/r7eSi-diff-1920.png) | **一致** |
| 3 | `w8W4Eh` | 3-3-A 統合ユーザー詳細 | 5.0048% | 0px | 中央・中央 | — | [差分画像](friends-v6/w8W4Eh-diff-1920.png) | **一致** |
| 3 | `vtBCu` | 3-4 UID移行 | 6.0778% | +146px | 中央・中央 | — | [差分画像](friends-v6/vtBCu-diff-1920.png) | **一致** |
| 5 | `TC1b1` | 5-1 シナリオ配信 | 3.6394% | 0px | 中央・中央 | — | [差分画像](scenarios-v6/TC1b1-diff-1920.png) | **一致** |
| 5 | `cCB7r` | 5-1-A シナリオ作成・配信方式 | 10.1778% ⚠ | 0px | 下部・中央 | — | [差分画像](scenarios-v6/cCB7r-diff-1920.png) | **一致** |
| 5 | `kk8dz` | 5-1-B シナリオ作成・1通目設定 | 5.7896% | +65px | 中央・右 | — | [差分画像](scenarios-v6/kk8dz-diff-1920.png) | **一致** |
| 5 | `bV5Vs` | 5-1-C シナリオ編集 | 5.4237% | 0px | 上部・右 | — | [差分画像](scenarios-v6/bV5Vs-diff-1920.png) | **一致** |
| 5 | `xfYLn` | 5-1-D シナリオ・ステップ編集 | 11.2533% ⚠ | 0px | 中央・右 | — | [差分画像](scenarios-v6/xfYLn-diff-1920.png) | **一致** |
| 5 | `r6Gzsu` | 5-1-E シナリオ・配信条件を開く | 10.0651% ⚠ | 0px | 上部・右 | — | [差分画像](scenarios-v6/r6Gzsu-diff-1920.png) | **一致** |
| 5 | `hz9ti` | 5-1-F シナリオ・送信後アクションを開く | 9.4239% | 0px | 上部・右 | — | [差分画像](scenarios-v6/hz9ti-diff-1920.png) | **一致** |
| 5 | `dqFft` | 5-1-G シナリオ・ステップ削除確認 | 9.8357% | 0px | 上部・右 | — | [差分画像](scenarios-v6/dqFft-diff-1920.png) | **一致** |
| 5 | `EvVO5` | 5-1-H シナリオ・開始条件を開く | 4.2237% | 0px | 上部・左 | — | [差分画像](scenarios-v6/EvVO5-diff-1920.png) | **一致** |
| 5 | `RUxNf` | 5-1-I シナリオ・配信開始確認 | 4.0442% | 0px | 上部・左 | — | [差分画像](scenarios-v6/RUxNf-diff-1920.png) | **一致** |
| 5 | `NrBkW` | 5-1-J シナリオ・配信開始完了 | 5.4857% | +8px | 上部・左 | — | [差分画像](scenarios-v6/NrBkW-diff-1920.png) | **一致** |
| 5 | `g2UNV` | 5-1-K シナリオ・テスト送信 | 6.6573% | 0px | 中央・右 | — | [差分画像](scenarios-v6/g2UNV-diff-1920.png) | **一致** |
| 5 | `M2b2B` | 5-1-L シナリオ・配信結果 | 5.7403% | 0px | 中央・右 | — | [差分画像](scenarios-v6/M2b2B-diff-1920.png) | **一致** |
| 5 | `q5G45` | 5-1-M 一覧の状態（空・読込・エラー） | 3.4938% | 0px | 中央・中央 | — | [差分画像](scenarios-v6/q5G45-diff-1920.png) | **一致** |
| 6 | `q76C35` | 6-1 一斉配信 | 3.1518% | 0px | 中央・中央 | — | [差分画像](broadcasts-v6/q76C35-diff-1920.png) | **一致** |
| 6 | `zZ9fA` | 6-1-A 一斉配信を作成 | 12.1502% ⚠ | +30px | 中央・右 | — | [差分画像](broadcasts-v6/zZ9fA-diff-1920.png) | **一致** |
| 6 | `cPk8A` | 6-1-B 対象条件 | 4.4534% | 0px | 下部・中央 | — | [差分画像](broadcasts-v6/cPk8A-diff-1920.png) | **一致** |
| 6 | `XQfMD` | 6-1-C メッセージ編集 | 15.7404% ⚠ | +38px | 中央・右 | — | [差分画像](broadcasts-v6/XQfMD-diff-1920.png) | **一致** |
| 6 | `p97Tf` | 6-1-D テンプレート選択 | 5.7571% | 0px | 中央・右 | — | [差分画像](broadcasts-v6/p97Tf-diff-1920.png) | **一致** |
| 6 | `Bw0zt` | 6-1-E 送信設定 | 11.6072% ⚠ | 0px | 下部・右 | — | [差分画像](broadcasts-v6/Bw0zt-diff-1920.png) | **一致** |
| 6 | `h0kahp` | 6-1-F テスト送信 | 9.6138% | 0px | 中央・右 | — | [差分画像](broadcasts-v6/h0kahp-diff-1920.png) | **一致** |
| 6 | `vW4Es` | 6-1-G 配信前チェック | 5.4820% | 0px | 中央・右 | — | [差分画像](broadcasts-v6/vW4Es-diff-1920.png) | **一致** |
| 6 | `FpgxH` | 6-1-H 最終確認 | 15.8702% ⚠ | 0px | 中央・右 | — | [差分画像](broadcasts-v6/FpgxH-diff-1920.png) | **一致** |
| 6 | `bPF0s` | 6-1-I 一斉配信・予約完了 | 2.8796% | +43px | 中央・中央 | — | [差分画像](broadcasts-v6/bPF0s-diff-1920.png) | **一致** |
| 6 | `u6gHt` | 6-1-J 結果詳細 | 6.2805% | 0px | 中央・右 | — | [差分画像](broadcasts-v6/u6gHt-diff-1920.png) | **一致** |
| 6 | `EGMb1` | 6-1-K 削除確認 | 13.6050% ⚠ | 0px | 中央・中央 | — | [差分画像](broadcasts-v6/EGMb1-diff-1920.png) | **一致** |
| 6 | `sqFXf` | 6-1-L 対象条件を編集 | 7.1272% | 0px | 下部・中央 | — | [差分画像](broadcasts-v6/sqFXf-diff-1920.png) | **一致** |
| 6 | `xkRDb` | 6-1-M フォルダ操作 | 3.2987% | 0px | 中央・左 | — | [差分画像](broadcasts-v6/xkRDb-diff-1920.png) | **一致** |
| 6 | `TmHjF` | 6-1-N 一覧の状態（空・読込・エラー） | 2.8644% | 0px | 中央・中央 | — | [差分画像](broadcasts-v6/TmHjF-diff-1920.png) | **一致** |
| 7 | `M1EXwB` | 7-1 リマインダ | 3.0901% | 0px | 中央・左 | — | [差分画像](reminders-v6/M1EXwB-diff-1920.png) | **一致** |
| 7 | `uJP22` | 7-1-A リマインダを作成 | 12.0397% ⚠ | +65px | 中央・右 | — | [差分画像](reminders-v6/uJP22-diff-1920.png) | **一致** |
| 7 | `J64xI` | 7-1-B 通知ステップ編集 | 11.1932% ⚠ | +93px | 中央・右 | — | [差分画像](reminders-v6/J64xI-diff-1920.png) | **一致** |
| 7 | `s7T2dz` | 7-1-C 対象と終了条件 | 4.2914% | -56px | 中央・左 | — | [差分画像](reminders-v6/s7T2dz-diff-1920.png) | **一致** |
| 7 | `JCz6J` | 7-1-D 配信予定プレビュー | 9.5545% | -56px | 下部・右 | — | [差分画像](reminders-v6/JCz6J-diff-1920.png) | **一致** |
| 7 | `W98zZQ` | 7-1-E テスト送信確認 | 18.4705% ⚠ | 0px | 中央・中央 | — | [差分画像](reminders-v6/W98zZQ-diff-1920.png) | **一致** |
| 7 | `s6Vvp` | 7-1-F 最終確認 | 8.5733% | 0px | 中央・右 | — | [差分画像](reminders-v6/s6Vvp-diff-1920.png) | **一致** |
| 7 | `PSmHo` | 7-1-G 有効化完了 | 8.4985% | -56px | 下部・右 | — | [差分画像](reminders-v6/PSmHo-diff-1920.png) | **一致** |
| 7 | `GC4St` | 7-1-H 実行結果 | 9.7844% | +67px | 下部・右 | — | [差分画像](reminders-v6/GC4St-diff-1920.png) | **一致** |
| 7 | `Y0Sn3` | 7-1-I 削除確認 | 13.5984% ⚠ | 0px | 中央・中央 | — | [差分画像](reminders-v6/Y0Sn3-diff-1920.png) | **一致** |
| 7 | `dC0yg` | 7-1-J 一覧の状態（空・読込・エラー） | 2.9622% | 0px | 中央・中央 | — | [差分画像](reminders-v6/dC0yg-diff-1920.png) | **一致** |
| 8 | `cmDfJ` | 8-1 自動応答 | 3.7387% | 0px | 中央・左 | — | [差分画像](auto-replies-v6/cmDfJ-diff-1920.png) | **一致** |
| 8 | `K7vg2` | 8-1-A 自動応答ルール編集 | 10.7442% ⚠ | +36px | 中央・右 | — | [差分画像](auto-replies-v6/K7vg2-diff-1920.png) | **一致** |
| 8 | `nzWIX` | 8-1-B 反応条件 | 4.8555% | +131px | 中央・左 | — | [差分画像](auto-replies-v6/nzWIX-diff-1920.png) | **一致** |
| 8 | `ivDoe` | 8-1-C 応答とアクション | 11.1802% ⚠ | -56px | 中央・右 | — | [差分画像](auto-replies-v6/ivDoe-diff-1920.png) | **一致** |
| 8 | `U9hzqH` | 8-1-D 競合と優先順位 | 5.5345% | +57px | 下部・右 | — | [差分画像](auto-replies-v6/U9hzqH-diff-1920.png) | **一致** |
| 8 | `g46ja` | 8-1-E 自動応答テスト | 5.9914% | 0px | 中央・右 | — | [差分画像](auto-replies-v6/g46ja-diff-1920.png) | **一致** |
| 8 | `Yj6CQ` | 8-1-F 最終確認 | 5.6140% | 0px | 下部・中央 | — | [差分画像](auto-replies-v6/Yj6CQ-diff-1920.png) | **一致** |
| 8 | `e6iJG` | 8-1-G 有効化完了 | 4.5472% | +23px | 下部・右 | — | [差分画像](auto-replies-v6/e6iJG-diff-1920.png) | **一致** |
| 8 | `t7UtYQ` | 8-1-H 実行結果 | 4.5475% | +14px | 中央・右 | — | [差分画像](auto-replies-v6/t7UtYQ-diff-1920.png) | **一致** |
| 8 | `Gy9OK` | 8-1-I 削除確認 | 14.6352% ⚠ | 0px | 中央・中央 | — | [差分画像](auto-replies-v6/Gy9OK-diff-1920.png) | **一致** |
| 8 | `q8wSqO` | 8-1-J 一覧の状態（空・読込・エラー） | 3.4920% | 0px | 上部・左 | — | [差分画像](auto-replies-v6/q8wSqO-diff-1920.png) | **一致** |
| 9 | `uLQQc` | 9-1 友だち追加時の配信 | 3.8692% | 0px | 中央・左 | — | [差分画像](friend-add-v6/uLQQc-diff-1920.png) | **一致** |
| 9 | `s9gAx` | 9-1-A 基本設定 | —（設計画像なし） | — | — | — | — | **一致** |
| 9 | `W1wzCa` | 9-1-B 流入条件 | —（設計画像なし） | — | — | — | — | **一致** |
| 9 | `K0Dbr2` | 9-1-C 初回案内 | —（設計画像なし） | — | — | — | — | **一致** |
| 9 | `txMO9` | 9-1-D アクション追加 | 18.3887% ⚠ | 0px | 中央・中央 | — | [差分画像](friend-add-v6/txMO9-diff-1920.png) | **一致** |
| 9 | `U3SI5` | 9-1-E プレビューとテスト | 10.2700% ⚠ | 0px | 中央・右 | — | [差分画像](friend-add-v6/U3SI5-diff-1920.png) | **一致** |
| 9 | `ec9vg` | 9-1-F 最終確認 | 9.2198% | -56px | 中央・右 | — | [差分画像](friend-add-v6/ec9vg-diff-1920.png) | **一致** |
| 9 | `quhg6` | 9-1-G 有効化完了 | 3.7517% | 0px | 中央・右 | — | [差分画像](friend-add-v6/quhg6-diff-1920.png) | **一致** |
| 9 | `P2J0Te` | 9-1-H 実行結果 | 5.0878% | 0px | 下部・中央 | — | [差分画像](friend-add-v6/P2J0Te-diff-1920.png) | **一致** |
| 9 | `Q3qP1r` | 9-1-I 削除確認 | —（設計画像なし） | — | — | — | — | **一致** |
| 10 | `ZC13r` | 10-1 ウェビナー | 2.8960% | 0px | 上部・左 | — | [差分画像](webinars-v6/ZC13r-diff-1920.png) | **一致** |
| 10 | `lvaY5` | 10-1-A ウェビナーを作成 | 10.7418% ⚠ | 0px | 中央・右 | — | [差分画像](webinars-v6/lvaY5-diff-1920.png) | **一致** |
| 10 | `PV1Vh` | 10-1-B 動画・公開設定 | 10.6416% ⚠ | 0px | 中央・右 | — | [差分画像](webinars-v6/PV1Vh-diff-1920.png) | **一致** |
| 10 | `d3rFGD` | 10-1-C CTA・フォーム | 11.0389% ⚠ | 0px | 中央・右 | — | [差分画像](webinars-v6/d3rFGD-diff-1920.png) | **一致** |
| 10 | `Ho8z4` | 10-1-D 通知・リマインド | 11.0793% ⚠ | 0px | 中央・右 | — | [差分画像](webinars-v6/Ho8z4-diff-1920.png) | **一致** |
| 10 | `Xjk8q` | 10-1-E 視聴後アクション | 14.7480% ⚠ | +183px | 中央・右 | — | [差分画像](webinars-v6/Xjk8q-diff-1920.png) | **一致** |
| 10 | `GB0NR` | 10-1-F 公開ページプレビュー | 10.8872% ⚠ | 0px | 中央・右 | — | [差分画像](webinars-v6/GB0NR-diff-1920.png) | **一致** |
| 10 | `D6yO7e` | 10-1-G 公開前確認 | 13.7216% ⚠ | +295px | 中央・右 | — | [差分画像](webinars-v6/D6yO7e-diff-1920.png) | **一致** |
| 10 | `TimXl` | 10-1-H 公開完了 | 3.6839% | 0px | 中央・中央 | — | [差分画像](webinars-v6/TimXl-diff-1920.png) | **一致** |
| 10 | `Q8sHa` | 10-1-I 参加者管理 | 3.9349% | 0px | 中央・右 | — | [差分画像](webinars-v6/Q8sHa-diff-1920.png) | **一致** |
| 10 | `yxyzQ` | 10-1-J 分析 | 10.7692% ⚠ | 0px | 中央・右 | — | [差分画像](webinars-v6/yxyzQ-diff-1920.png) | **一致** |
| 10 | `LKuAQ` | 10-1-K アーカイブ確認 | —（設計画像なし） | — | — | — | — | **一致** |
| 10 | `zCQXe` | 10-1-L 一覧の状態（空・読込・エラー） | 3.0090% | 0px | 中央・中央 | — | [差分画像](webinars-v6/zCQXe-diff-1920.png) | **一致** |
| 11 | `W7LBc` | 11-1 テンプレート | 5.0116% | 0px | 中央・中央 | — | [差分画像](templates-v6/W7LBc-diff-1920.png) | **一致** |
| 11 | `GFlD7` | 11-1-A メッセージを作る | 8.0376% | -56px | 中央・右 | — | [差分画像](templates-v6/GFlD7-diff-1920.png) | **一致** |
| 11 | `FRkls` | 11-1-B カルーセルを作る | 6.6401% | 0px | 中央・右 | — | [差分画像](templates-v6/FRkls-diff-1920.png) | **一致** |
| 11 | `NNDMR` | 11-1-C 質問を作る | 6.8783% | +160px | 上部・右 | — | [差分画像](templates-v6/NNDMR-diff-1920.png) | **一致** |
| 11 | `j9ixI` | 11-1-D リッチメッセージを作る | 5.6969% | 0px | 中央・右 | — | [差分画像](templates-v6/j9ixI-diff-1920.png) | **一致** |
| 11 | `hsBtl` | 11-1-E クーポンを作る | 6.4859% | 0px | 中央・右 | — | [差分画像](templates-v6/hsBtl-diff-1920.png) | **一致** |
| 11 | `J3GxEZ` | 11-1-F リサーチを作る | 7.1590% | +1px | 中央・右 | — | [差分画像](templates-v6/J3GxEZ-diff-1920.png) | **一致** |
| 11 | `M9cij` | 11-1-G テンプレートの削除確認 | 5.1187% | -1px | 上部・左 | — | [差分画像](templates-v6/M9cij-diff-1920.png) | **一致** |
| 11 | `CzndJ` | 11-1-H フォルダ操作 | 5.0695% | 0px | 中央・中央 | — | [差分画像](templates-v6/CzndJ-diff-1920.png) | **一致** |
| 11 | `NKyoA` | 11-1-I 一覧の状態（空・読込・エラー） | 4.5635% | 0px | 上部・左 | — | [差分画像](templates-v6/NKyoA-diff-1920.png) | **一致** |
| 12 | `GO8RQ` | 12-1 リッチメニュー | 3.5247% | 0px | 上部・左 | — | [差分画像](rich-menus-v6/GO8RQ-diff-1920.png) | **一致** |
| 12 | `XtfO3` | 12-1-A メニューを作る・形とボタン | 7.7052% | 0px | 上部・右 | — | [差分画像](rich-menus-v6/XtfO3-diff-1920.png) | **一致** |
| 12 | `kQ1bs` | 12-1-B メニューを作る・誰に出すか | 4.1634% | 0px | 中央・中央 | — | [差分画像](rich-menus-v6/kQ1bs-diff-1920.png) | **一致** |
| 12 | `DIUbO` | 12-1-C 切替メニューのつながり | 6.8123% | 0px | 上部・右 | — | [差分画像](rich-menus-v6/DIUbO-diff-1920.png) | **一致** |
| 12 | `NXdDk` | 12-1-C-A つながりなし | 5.7131% | 0px | 上部・右 | — | [差分画像](rich-menus-v6/NXdDk-diff-1920.png) | **一致** |
| 12 | `UMiJ9` | 12-1-D メニューを作る・公開のしかた | 3.9878% | 0px | 中央・中央 | — | [差分画像](rich-menus-v6/UMiJ9-diff-1920.png) | **一致** |
| 12 | `TL7tp` | 12-1-E 管理画面の外のメニューを取り込む | 3.5394% | 0px | 中央・右 | — | [差分画像](rich-menus-v6/TL7tp-diff-1920.png) | **一致** |
| 12 | `szXsT` | 12-1-F リッチメニューの削除確認 | 8.8107% | 0px | 中央・右 | — | [差分画像](rich-menus-v6/szXsT-diff-1920.png) | **一致** |
| 12 | `RW5Tb` | 12-1-G 一覧の状態（空・読込・エラー） | 3.1879% | 0px | 上部・左 | — | [差分画像](rich-menus-v6/RW5Tb-diff-1920.png) | **一致** |
| 13 | `EMBIK` | 13-1 回答フォーム | 3.3943% | 0px | 中央・右 | — | [差分画像](forms-v6/EMBIK-diff-1920.png) | **一致** |
| 13 | `vCqUj` | 13-1-A フォームを作る | 6.5395% | +2758px | 下部・左 | — | [差分画像](forms-v6/vCqUj-diff-1920.png) | **一致** |
| 13 | `ava2n` | 13-1-B フォームのデザイン設定 | 5.7465% | -1px | 下部・左 | — | [差分画像](forms-v6/ava2n-diff-1920.png) | **一致** |
| 13 | `cSqvP` | 13-1-C フォームのオプション設定 | 6.3555% | 0px | 下部・左 | — | [差分画像](forms-v6/cSqvP-diff-1920.png) | **一致** |
| 13 | `v9tYhl` | 13-1-D 集まった回答 | 3.3300% | 0px | 中央・左 | — | [差分画像](forms-v6/v9tYhl-diff-1920.png) | **一致** |
| 13 | `gBp2J` | 13-1-E フォームの削除確認 | 10.4375% ⚠ | -1px | 上部・中央 | — | [差分画像](forms-v6/gBp2J-diff-1920.png) | **一致** |
| 13 | `ZOPyc` | 13-1-F 一覧の状態（空・読込・エラー） | 2.9594% | 0px | 上部・左 | — | [差分画像](forms-v6/ZOPyc-diff-1920.png) | **一致** |
| 14 | `WuKzU` | 14-1 共通情報 | 3.1703% | 0px | 上部・左 | — | [差分画像](common-vars-v6/WuKzU-diff-1920.png) | **一致** |
| 14 | `gBtaK` | 14-1-A 共通情報を編集 | 4.9666% | 0px | 中央・左 | — | [差分画像](common-vars-v6/gBtaK-diff-1920.png) | **一致** |
| 14 | `uNBlA` | 14-1-B 変える前に影響を見る | 4.2428% | 0px | 中央・中央 | — | [差分画像](common-vars-v6/uNBlA-diff-1920.png) | **一致** |
| 14 | `yPkWe` | 14-1-C 共通情報の削除確認 | 14.7419% ⚠ | 0px | 下部・中央 | — | [差分画像](common-vars-v6/yPkWe-diff-1920.png) | **一致** |
| 15 | `g89Tc` | 15-1 登録メディア | 2.8874% | 0px | 中央・右 | — | [差分画像](media-v6/g89Tc-diff-1920.png) | **一致** |
| 15 | `voJtX` | 15-1-A メディアの詳細と差し替え | 2.7174% | 0px | 中央・右 | — | [差分画像](media-v6/voJtX-diff-1920.png) | **一致** |
| 15 | `eXAJP` | 15-1-B ファイルを入れる | 8.4698% | 0px | 下部・中央 | — | [差分画像](media-v6/eXAJP-diff-1920.png) | **一致** |
| 15 | `YfTfJ` | 15-1-C メディアの削除確認 | 12.0340% ⚠ | 0px | 上部・中央 | — | [差分画像](media-v6/YfTfJ-diff-1920.png) | **一致** |
| 15 | `h8pBZr` | 15-1-D 一覧の状態（空・読込・エラー） | 3.4629% | 0px | 中央・中央 | — | [差分画像](media-v6/h8pBZr-diff-1920.png) | **一致** |
| 16 | `PouPn` | 16-1 成果とアフィリエイト | 4.6352% | -56px | 中央・左 | — | [差分画像](affiliates-v6/PouPn-diff-1920.png) | **一致** |
| 16 | `GH8VL` | 16-1-A 案件 | 4.3863% | 0px | 中央・左 | — | [差分画像](affiliates-v6/GH8VL-diff-1920.png) | **一致** |
| 16 | `n5VVTb` | 16-1-B 成果承認 | 6.5642% | -56px | 下部・右 | — | [差分画像](affiliates-v6/n5VVTb-diff-1920.png) | **一致** |
| 16 | `njLGA` | 16-1-C 支払い | 4.1592% | 0px | 中央・左 | — | [差分画像](affiliates-v6/njLGA-diff-1920.png) | **一致** |
| 16 | `xqT1Z` | 16-1-D アフィリエイターを登録する | 5.3374% | 0px | 中央・左 | — | [差分画像](affiliates-v6/xqT1Z-diff-1920.png) | **一致** |
| 16 | `jwrbf` | 16-1-E アフィリエイターの成果内訳 | 5.1568% | 0px | 中央・右 | — | [差分画像](affiliates-v6/jwrbf-diff-1920.png) | **一致** |
| 16 | `GPWzq` | 16-1-F 案件をつくる | 5.0148% | +209px | 中央・左 | — | [差分画像](affiliates-v6/GPWzq-diff-1920.png) | **一致** |
| 16 | `QX70l` | 16-1-G アフィリエイターを削除する確認 | —（設計画像なし） | — | — | — | — | **一致** |
| 16 | `GqFTV` | 16-1-H 支払いを確定する | 7.9215% | -1px | 下部・中央 | — | [差分画像](affiliates-v6/GqFTV-diff-1920.png) | **一致** |
| 17 | `s98Vfw` | 17-1 マイル | 4.7372% | 0px | 中央・左 | — | [差分画像](mileage-v6/s98Vfw-diff-1920.png) | **一致** |
| 17 | `N46cQ` | 17-1-A たまる決めごと | 5.2533% | +512px | 中央・左 | — | [差分画像](mileage-v6/N46cQ-diff-1920.png) | **一致** |
| 17 | `qlVLJ` | 17-1-B マイルの使い道 | 4.4946% | 0px | 中央・左 | — | [差分画像](mileage-v6/qlVLJ-diff-1920.png) | **一致** |
| 17 | `MvZm5` | 17-1-C マイルの履歴 | 4.7272% | +83px | 上部・左 | — | [差分画像](mileage-v6/MvZm5-diff-1920.png) | **一致** |
| 17 | `BmoGY` | 17-1-D たまる決めごとをつくる | 7.0172% | +895px | 上部・右 | — | [差分画像](mileage-v6/BmoGY-diff-1920.png) | **一致** |
| 17 | `HIU5O` | 17-1-E 友だちのマイル明細 | 5.4628% | -56px | 中央・右 | — | [差分画像](mileage-v6/HIU5O-diff-1920.png) | **一致** |
| 17 | `vz0Ji` | 17-1-F マイルを手で増やす・減らす | 6.1014% | 0px | 中央・左 | — | [差分画像](mileage-v6/vz0Ji-diff-1920.png) | **一致** |
| 17 | `p9CcEB` | 17-1-G マイルの使い道をつくる | 6.3678% | +701px | 上部・右 | — | [差分画像](mileage-v6/p9CcEB-diff-1920.png) | **一致** |
| 17 | `k8VCU` | 17-1-H たまる決めごと・一覧の状態 | 4.0657% | +512px | 上部・左 | — | [差分画像](mileage-v6/k8VCU-diff-1920.png) | **一致** |
| 17 | `z3PB2` | 17-2 行動スコア | 5.2937% | 0px | 上部・左 | — | [差分画像](mileage-v6/z3PB2-diff-1920.png) | **一致** |
| 17 | `s6MBc` | 17-2-A スコアのルール | —（設計画像なし） | — | — | — | — | **一致** |
| 18 | `Q4bkTg` | 18-1 流入と計測 | 5.6635% | 0px | 中央・左 | — | [差分画像](inflow-v6/Q4bkTg-diff-1920.png) | **一致** |
| 18 | `IhSBB` | 18-1-A サイトスクリプト | 4.7742% | -40px | 中央・右 | — | [差分画像](inflow-v6/IhSBB-diff-1920.png) | **一致** |
| 18 | `v0HaI` | 18-1-B 広告連携 | 3.8252% | 0px | 中央・右 | — | [差分画像](inflow-v6/v0HaI-diff-1920.png) | **一致** |
| 18 | `TEVk8` | 18-1-C 流入リンクをつくる | 5.0606% | +408px | 中央・左 | — | [差分画像](inflow-v6/TEVk8-diff-1920.png) | **一致** |
| 18 | `JupxW` | 18-1-D 流入元の詳細 | 4.0418% | 0px | 中央・右 | — | [差分画像](inflow-v6/JupxW-diff-1920.png) | **一致** |
| 18 | `UIaM7` | 18-1-E 流入リンクの削除確認 | 5.0928% | 0px | 中央・中央 | — | [差分画像](inflow-v6/UIaM7-diff-1920.png) | **一致** |
| 18 | `BMmxU` | 18-1-F 一覧の状態（空・読込・エラー） | 5.1326% | -56px | 中央・左 | — | [差分画像](inflow-v6/BMmxU-diff-1920.png) | **一致** |
| 18 | `BuVDB` | 18-2 広告とのつなぎ（成果の対応付け） | 4.3284% | +202px | 中央・右 | — | [差分画像](inflow-v6/BuVDB-diff-1920.png) | **一致** |
| 18 | `Im2b1` | 18-2-A 広告への送信履歴 | 4.0981% | 0px | 中央・左 | — | [差分画像](inflow-v6/Im2b1-diff-1920.png) | **一致** |
| 19 | `ZrpKn` | 19-1 コンバージョン | 6.4001% | 0px | 下部・右 | — | [差分画像](conversions-v6/ZrpKn-diff-1920.png) | **一致** |
| 19 | `GUxsj` | 19-1-A コンバージョン レポート | 8.2785% | +15px | 中央・中央 | — | [差分画像](conversions-v6/GUxsj-diff-1920.png) | **一致** |
| 19 | `GtylA` | 19-1-B 成果地点をつくる | 5.6535% | 0px | 中央・左 | — | [差分画像](conversions-v6/GtylA-diff-1920.png) | **一致** |
| 19 | `d8d3Mz` | 19-1-C 成果地点の削除確認 | 7.8171% | 0px | 下部・右 | — | [差分画像](conversions-v6/d8d3Mz-diff-1920.png) | **一致** |
| 20 | `Zxezb` | 20-1 分析（友だちの増減） | 7.4027% | -56px | 中央・中央 | — | [差分画像](analytics-v6/Zxezb-diff-1920.png) | **一致** |
| 20 | `J6Inc` | 20-1-A 配信の反応 | 6.0785% | 0px | 中央・中央 | — | [差分画像](analytics-v6/J6Inc-diff-1920.png) | **一致** |
| 20 | `YBGtm` | 20-1-B 経路と成果 | 3.2928% | 0px | 中央・右 | — | [差分画像](analytics-v6/YBGtm-diff-1920.png) | **一致** |
| 20 | `QQ1SR` | 20-1-C 使われ方 | 3.4144% | 0px | 中央・右 | — | [差分画像](analytics-v6/QQ1SR-diff-1920.png) | **一致** |
| 20 | `URqOA` | 20-1-D 定期レポートをつくる | —（設計画像なし） | — | — | — | — | **一致** |
| 20 | `f5HsX` | 20-2 クロス分析 | 6.5307% | +441px | 下部・中央 | — | [差分画像](analytics-v6/f5HsX-diff-1920.png) | **一致** |
| 20 | `C2I7ry` | 20-2-A ファネル分析 | 8.2295% | +393px | 下部・左 | — | [差分画像](analytics-v6/C2I7ry-diff-1920.png) | **一致** |
| 20 | `Fh2Qj` | 20-2-B URLクリック | 3.1944% | 0px | 中央・左 | — | [差分画像](analytics-v6/Fh2Qj-diff-1920.png) | **一致** |
| 20 | `dfwD4` | 20-2-C 保存した分析 | 4.4324% | 0px | 中央・左 | — | [差分画像](analytics-v6/dfwD4-diff-1920.png) | **一致** |
| 21 | `VLMGH` | 21-1 NEN配信 | 4.9451% | +191px | 下部・右 | — | [差分画像](nen-v6/VLMGH-diff-1920.png) | **一致** |
| 21 | `DEX0k` | 21-1-A NENコラム | 5.0110% | +192px | 中央・右 | — | [差分画像](nen-v6/DEX0k-diff-1920.png) | **一致** |
| 21 | `q4lajm` | 21-1-B ペット・記念日 | 7.5653% | +230px | 中央・右 | — | [差分画像](nen-v6/q4lajm-diff-1920.png) | **一致** |
| 21 | `WeXbL` | 21-1-C NEN配信の履歴 | 5.0101% | +43px | 中央・左 | — | [差分画像](nen-v6/WeXbL-diff-1920.png) | **一致** |
| 21 | `HpKyF` | 21-1-D NEN配信の中身を編集する | 5.5549% | +28px | 中央・右 | — | [差分画像](nen-v6/HpKyF-diff-1920.png) | **一致** |
| 21 | `ymXJK` | 21-1-E コラムを書く | 7.0115% | +236px | 中央・右 | — | [差分画像](nen-v6/ymXJK-diff-1920.png) | **一致** |
| 21 | `i9sQP` | 21-1-F NENコラム・一覧の状態 | 4.2514% | +192px | 上部・左 | — | [差分画像](nen-v6/i9sQP-diff-1920.png) | **一致** |
| 22 | `Qu6Vk` | 22-1 写真審査 | 6.0722% | 0px | 中央・中央 | — | [差分画像](photos-v6/Qu6Vk-diff-1920.png) | **一致** |
| 22 | `hHrz8` | 22-1-A 写真を1枚ずつ見る | —（設計画像なし） | — | — | — | — | **一致** |
| 22 | `N2J629` | 22-1-B 写真を戻す理由をえらぶ | 11.6056% ⚠ | 0px | 中央・左 | — | [差分画像](photos-v6/N2J629-diff-1920.png) | **一致** |
| 22 | `J3Wxl8` | 22-1-C 出しているもの | —（設計画像なし） | — | — | — | — | **一致** |
| 23 | `eI3gs` | 23-1 EC連携 | 4.9047% | 0px | 中央・左 | — | [差分画像](ec-v6/eI3gs-diff-1920.png) | **一致** |
| 23 | `ELayY` | 23-1-A 会員のつき合わせ | 3.5071% | 0px | 中央・左 | — | [差分画像](ec-v6/ELayY-diff-1920.png) | **一致** |
| 23 | `bfB50` | 23-1-B 定期便 | —（設計画像なし） | — | — | — | — | **一致** |
| 23 | `oHAN4` | 23-1-C EC連携のつなぎ先 | —（設計画像なし） | — | — | — | — | **一致** |
| 24 | `festr` | 24-1 LINE通知 | 4.8107% | +38px | 中央・左 | — | [差分画像](line-notify-v6/festr-diff-1920.png) | **一致** |
| 24 | `Q55bb` | 24-1-A お知らせの中身を編集する | 7.7882% | 0px | 中央・右 | — | [差分画像](line-notify-v6/Q55bb-diff-1920.png) | **一致** |
| 24 | `X8JCA5` | 24-1-B 送れなかったもの | 3.5328% | 0px | 上部・左 | — | [差分画像](line-notify-v6/X8JCA5-diff-1920.png) | **一致** |
| 24 | `Se65i` | 24-1-C お知らせの記録 | 4.0349% | 0px | 中央・左 | — | [差分画像](line-notify-v6/Se65i-diff-1920.png) | **一致** |
| 24 | `DpxOK` | 24-2 運用者へのお知らせ | 4.7706% | 0px | 中央・左 | — | [差分画像](line-notify-v6/DpxOK-diff-1920.png) | **一致** |
| 24 | `N2gAza` | 24-2-A 運用者へのお知らせをつくる | 4.1884% | +67px | 中央・左 | — | [差分画像](line-notify-v6/N2gAza-diff-1920.png) | **一致** |
| 25 | `gief7` | 25-1 オートメーション | 5.1613% | 0px | 中央・左 | — | [差分画像](automations-v6/gief7-diff-1920.png) | **一致** |
| 25 | `Rv8Jv` | 25-1-A オートメーションをつくる | 6.1060% | +169px | 中央・左 | — | [差分画像](automations-v6/Rv8Jv-diff-1920.png) | **一致** |
| 25 | `DkPY0` | 25-1-B オートメーションが動いた記録 | 5.3876% | 0px | 中央・左 | — | [差分画像](automations-v6/DkPY0-diff-1920.png) | **一致** |
| 25 | `WjYAC` | 25-1-C 見本から作る | 5.1685% | 0px | 中央・中央 | — | [差分画像](automations-v6/WjYAC-diff-1920.png) | **一致** |
| 25 | `Vdbv5` | 25-1-D 一覧の状態（空・読込・エラー） | 4.4432% | 0px | 中央・左 | — | [差分画像](automations-v6/Vdbv5-diff-1920.png) | **一致** |
| 25 | `xOpDs` | 25-2 共通アクション | 5.2763% | 0px | 中央・左 | — | [差分画像](automations-v6/xOpDs-diff-1920.png) | **一致** |
| 25 | `py5CG` | 25-2-A 共通アクションをつくる | 4.2824% | +85px | 中央・右 | — | [差分画像](automations-v6/py5CG-diff-1920.png) | **一致** |
| 25 | `syWp4` | 25-2-B 共通アクションの版と使われている場所 | 4.7846% | +220px | 上部・左 | — | [差分画像](automations-v6/syWp4-diff-1920.png) | **一致** |
| 26 | `k3WxrO` | 26-1 外部連携 | 4.4603% | 0px | 中央・右 | — | [差分画像](webhooks-v6/k3WxrO-diff-1920.png) | **一致** |
| 26 | `M0Gb7` | 26-1-A こちらで受け取る | 16.0302% ⚠ | +223px | 下部・中央 | — | [差分画像](webhooks-v6/M0Gb7-diff-1920.png) | **一致** |
| 26 | `KNG00` | 26-1-B やり取りの記録 | 5.0487% | 0px | 中央・左 | — | [差分画像](webhooks-v6/KNG00-diff-1920.png) | **一致** |
| 26 | `f8SBSh` | 26-1-C 一覧の状態（空・読込・エラー） | 3.8223% | 0px | 中央・中央 | — | [差分画像](webhooks-v6/f8SBSh-diff-1920.png) | **一致** |
| 27 | `TV2DI` | 27-1 予約管理 | 4.6730% | -64px | 中央・右 | — | [差分画像](booking-v6/TV2DI-diff-1920.png) | **一致** |
| 27 | `TnDbq` | 27-1-A 予約の詳細 | 5.3594% | 0px | 上部・右 | — | [差分画像](booking-v6/TnDbq-diff-1920.png) | **一致** |
| 27 | `cpdDi` | 27-1-B 電話の予約を入れる | 6.6680% | +227px | 上部・右 | — | [差分画像](booking-v6/cpdDi-diff-1920.png) | **一致** |
| 27 | `SbuUI` | 27-1-C 今週の予約 | 4.4693% | 0px | 中央・左 | — | [差分画像](booking-v6/SbuUI-diff-1920.png) | **一致** |
| 27 | `GFDqW` | 27-1-D 代理予約・内容確認 | 7.6298% | 0px | 上部・右 | — | [差分画像](booking-v6/GFDqW-diff-1920.png) | **一致** |
| 27 | `GfceK` | 27-1-E 代理予約・登録完了 | 6.8003% | +26px | 中央・右 | — | [差分画像](booking-v6/GfceK-diff-1920.png) | **一致** |
| 27 | `Lg8ff` | 27-1-F 代理予約・予約枠の重なりと入力エラー | 4.8883% | 0px | 中央・左 | — | [差分画像](booking-v6/Lg8ff-diff-1920.png) | **一致** |
| 28 | `QSLEH` | 28-1 予約設定 | 3.4602% | 0px | 中央・左 | — | [差分画像](booking-settings-v6/QSLEH-diff-1920.png) | **一致** |
| 28 | `tksPc` | 28-1-A 受付枠と休業日 | 5.9219% | +171px | 中央・右 | — | [差分画像](booking-settings-v6/tksPc-diff-1920.png) | **一致** |
| 28 | `GhOb3` | 28-1-B 予約メニューをつくる | 6.8295% | +658px | 上部・右 | — | [差分画像](booking-settings-v6/GhOb3-diff-1920.png) | **一致** |
| 28 | `W6465r` | 28-1-C 一覧の状態（空・読込・エラー） | 2.8767% | 0px | 中央・中央 | — | [差分画像](booking-settings-v6/W6465r-diff-1920.png) | **一致** |
| 29 | `ugP5y` | 29-1 イベント予約 | 4.4000% | 0px | 中央・左 | — | [差分画像](events-v6/ugP5y-diff-1920.png) | **一致** |
| 29 | `MKrPY` | 29-1-A イベントをつくる | 6.0708% | +642px | 中央・右 | — | [差分画像](events-v6/MKrPY-diff-1920.png) | **一致** |
| 29 | `i5SN2j` | 29-1-B 申込者の一覧 | 3.3306% | 0px | 上部・左 | — | [差分画像](events-v6/i5SN2j-diff-1920.png) | **一致** |
| 29 | `k5m5Bc` | 29-1-C 一覧の状態（空・読込・エラー） | 3.7226% | 0px | 上部・左 | — | [差分画像](events-v6/k5m5Bc-diff-1920.png) | **一致** |
| 30 | `e3jz3` | 30-1 ログインユーザー | 4.3899% | +194px | 中央・右 | — | [差分画像](staff-v6/e3jz3-diff-1920.png) | **一致** |
| 30 | `EOTS4` | 30-1-A 見せる範囲を決める | 4.8683% | 0px | 中央・左 | — | [差分画像](staff-v6/EOTS4-diff-1920.png) | **一致** |
| 30 | `jwVlo` | 30-1-B 入った記録 | 4.6135% | 0px | 中央・左 | — | [差分画像](staff-v6/jwVlo-diff-1920.png) | **一致** |
| 30 | `I3ZSrU` | 30-1-C 人を招待する | 4.8181% | -16px | 中央・左 | — | [差分画像](staff-v6/I3ZSrU-diff-1920.png) | **一致** |
| 31 | `c4R6F` | 31-1 機能設定 | 7.5002% | +81px | 中央・右 | — | [差分画像](settings-v6/c4R6F-diff-1920.png) | **一致** |
| 32 | `UgonK` | 32-1 運用状態・健全性チェック | 5.1817% | +75px | 中央・左 | — | [差分画像](operations-v6/UgonK-diff-1920.png) | **一致** |
| 32 | `b3HfZ` | 32-1-A 緊急コントロール | 5.3686% | -56px | 中央・右 | — | [差分画像](operations-v6/b3HfZ-diff-1920.png) | **一致** |
| 32 | `UhC2O` | 32-1-B 更新履歴 | 4.9458% | +445px | 中央・左 | — | [差分画像](operations-v6/UhC2O-diff-1920.png) | **一致** |
| 32 | `U0BwS` | 32-1-C 緊急停止の最終確認 | 4.8497% | 0px | 中央・中央 | — | [差分画像](operations-v6/U0BwS-diff-1920.png) | **一致** |
| 4 | `hqrOv` | 4-1 友だち属性・タグ | 3.8282% | +492px | 上部・左 | — | [差分画像](friend-attributes-v6/hqrOv-diff-1920.png) | **一致** |
| 4 | `dKlkz` | 4-1-F タグ削除の確認ダイアログ | 17.0407% ⚠ | 0px | 中央・右 | — | [差分画像](friend-attributes-v6/dKlkz-diff-1920.png) | **一致** |
| 4 | `H374MR` | 4-1-H タグCSV一括登録 | 3.0953% | 0px | 中央・中央 | snapshot | [差分画像](friend-attributes-v6/H374MR-diff-1920.png) | **一致** |
| 4 | `sfTEW` | 4-1-H-A CSV取り込み・確認（dry-run） | 3.4576% | 0px | 中央・左 | — | [差分画像](friend-attributes-v6/sfTEW-diff-1920.png) | **一致** |
| 4 | `op1rh` | 4-1-H-B CSV取り込み・完了 | 2.5624% | 0px | 中央・中央 | — | [差分画像](friend-attributes-v6/op1rh-diff-1920.png) | **一致** |
| 4 | `QzRsJ` | 4-1-H-C CSV取り込み・一部失敗 | 3.0981% | 0px | 中央・中央 | — | [差分画像](friend-attributes-v6/QzRsJ-diff-1920.png) | **一致** |
| 4 | `HBTk0` | 4-2 友だち情報欄 | 3.6538% | 0px | 中央・左 | — | [差分画像](friend-attributes-v6/HBTk0-diff-1920.png) | **一致** |
| 4 | `yKEdO` | 4-2-C 一覧の状態（空・読込・エラー） | 3.4372% | 0px | 上部・左 | — | [差分画像](friend-attributes-v6/yKEdO-diff-1920.png) | **一致** |
| 4 | `rIhbN` | 4-3 対応マーク | 3.5762% | 0px | 中央・中央 | — | [差分画像](friend-attributes-v6/rIhbN-diff-1920.png) | **一致** |
| 4 | `QKx8Q` | 4-4 保存した検索 | 3.9848% | 0px | 中央・左 | — | [差分画像](friend-attributes-v6/QKx8Q-diff-1920.png) | **一致** |
| 4 | `l25rlp` | 4-1-A タグを作る・初期状態 | 4.1692% | +4px | 中央・左 | — | [差分画像](friend-attributes-v6/l25rlp-diff-1920.png) | **一致** |
| 4 | `tP0RW` | 4-1-B タグを作る・連動ON | 5.3077% | +228px | 中央・左 | — | [差分画像](friend-attributes-v6/tP0RW-diff-1920.png) | **一致** |
| 4 | `LfrQs` | 4-1-C 連動アクション追加ドロワー | 4.8876% | 0px | 上部・右 | — | [差分画像](friend-attributes-v6/LfrQs-diff-1920.png) | **一致** |
| 4 | `ee0sk` | 4-1-D タグを編集・既存設定あり | 4.9532% | +242px | 下部・左 | — | [差分画像](friend-attributes-v6/ee0sk-diff-1920.png) | **一致** |
| 4 | `VjXGX` | 4-1-E 遡及反映の確認ダイアログ | 19.6324% ⚠ | 0px | 下部・中央 | — | [差分画像](friend-attributes-v6/VjXGX-diff-1920.png) | **一致** |
| 4 | `byqIW` | 4-1-G 属性フォルダを追加・色編集 | 7.3995% | 0px | 下部・中央 | — | [差分画像](friend-attributes-v6/byqIW-diff-1920.png) | **一致** |
| 4 | `A1ZYeP` | 4-2-A 友だち情報欄の項目を追加 | 3.3495% | 0px | 中央・中央 | — | [差分画像](friend-attributes-v6/A1ZYeP-diff-1920.png) | **一致** |
| 4 | `KoT6c` | 4-2-B 友だち情報欄・項目移行 | 3.3877% | +112px | 中央・左 | — | [差分画像](friend-attributes-v6/KoT6c-diff-1920.png) | **一致** |
| 4 | `GMvBd` | 4-3-A 対応マークを追加・編集 | 2.9869% | 0px | 上部・左 | — | [差分画像](friend-attributes-v6/GMvBd-diff-1920.png) | **一致** |
| 4 | `zGZMA` | 4-3-B 対応マーク削除の確認ダイアログ | 9.2834% | 0px | 中央・中央 | — | [差分画像](friend-attributes-v6/zGZMA-diff-1920.png) | **一致** |
| 4 | `XBkiQ` | 4-4-A 保存した検索の条件確認・編集 | 4.8057% | +68px | 中央・左 | — | [差分画像](friend-attributes-v6/XBkiQ-diff-1920.png) | **一致** |
| 3 | `ux7of` | 3-4-A UID・顧客データ移行／CSV | —（設計画像なし） | — | — | — | — | **一致** |
| 2 | `ohj8J` | 2-8-A 担当者の未読が数えられないとき | 6.9015% | 0px | 上部・中央 | — | [差分画像](inbox-v6/ohj8J-diff-1920.png) | **一致** |
| 33 | `QT91v` | 33-1 LINEアカウント一覧 | —（設計画像なし） | — | — | — | — | **一致** |
| 33 | `b2NGxk` | 33-2 LINEアカウントを登録する | —（設計画像なし） | — | — | — | — | **一致** |
| 33 | `T9rA9` | 33-3 LINEアカウントの詳細・編集 | —（設計画像なし） | — | — | — | — | **一致** |
| 33 | `nx3XW` | 33-4 乗り換え・引き継ぎ | —（設計画像なし） | — | — | — | — | **一致** |
| 34 | `RAW35` | 34-1 はじめの設定 | —（設計画像なし） | — | — | — | — | **一致** |
| 34 | `y0P0Qx` | 34-2 レシピ一覧 | —（設計画像なし） | — | — | — | — | **一致** |
| 34 | `D5UaX` | 34-3 レシピを複製する | —（設計画像なし） | — | — | — | — | **一致** |
| 34 | `f9oUm` | 34-4 マニュアルの正本表 | —（設計画像なし） | — | — | — | — | **一致** |

**「撮った先」が空**の機能は、まだ実装PRのheadで撮り直していません（自分の枝で撮ったものです）。**空欄を確認済みと読まないでください。**
