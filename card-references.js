"use strict";

// Verified printings with missing images or entries in the main catalogue.
const cardReferences = {
  "de": [
    {
      "id": "30th-c-001",
      "localId": "001",
      "name": "Glurak",
      "nameEn": "Charizard",
      "printedNumber": "4/102",
      "set": {
        "id": "30th-c",
        "name": "30 Jahre: Klassische Sammlung"
      },
      "variants": {
        "holo": true
      },
      "image": "https://pullwert.de/karten/30th-c/001/high.webp",
      "marketUrl": "https://www.cardmarket.com/de/Pokemon/Products/Singles/30th-Celebration/Charizard-30CBS-4?language=3",
      "marketLabel": "View this printing on Cardmarket ↗",
      "fingerprint": "zpY4y55L1rJs4Lpw67pt6b503KRa04xH0IxIzpc+06FOvK6l0Kh4x5ds15+A77KG7Jt913tawIVM05hT149F3Z5j4WU062s55o1F8Z4k53s5dWlQqmMkvGws35lN6ngl36s46IdIRnhsz405snk4PW5kpY5mvlgf68F23q1H2dll4rqGun1r1Z9L0JxQ26g14qZWxW0t8Lhr5oJU5otE06JxonJnzqte279r05tD06RJuYhH87dn1qNSwYgp7XIs3I9XtoRMj3ZN3qlX6cQR9cpL8rhptoxawJRIyJ5T0Kt1vJtrqotfwpJbz6JJ7bpr7bVm05eLxpWNx5+axpqUxJiQwpSNy4l76ama88N95L531rqxy62iyaecx6SZz7Wrzriyy6aa6cG268SC1atpz6SjyraxxqGXy6GW17uy18G76czEza+l4b591JZQu4d72KiW2LKjzaKT25iG56+e2aeY0rKm4Lh61o5EuH9w0Z6Lz52MyZ6LypiA0Y9zy3hixHdl2phTxYktyYg805BC36ZV57lp671r4KBP2Yg50oc+yJM5"
    }
  ],
  "ja": [
    // Three angles of the same unnumbered 2004 movie pack card.
    {
      "id": "vault-deoxys-lenticular",
      "localId": "Lenticular",
      "unnumbered": true,
      "name": "裂空のデオキシス",
      "nameEn": "Sky-Splitting Deoxys",
      "set": {
        "id": "2004-movie-vs",
        "name": "2004 Movie Commemoration VS Pack"
      },
      "variants": {
        "lenticular": true
      },
      "image": "visual/deoxys-lenticular.webp",
      "marketUrl": "https://www.cardmarket.com/Pokemon/Products?idProduct=902396",
      "localOnly": true,
      "fingerprints": [
        "xq2kwqmhy7aqzruv2cW56NPH58zD1LavxaSfx6SgsJyYdXBikH9rr4h0sX5zooaBd4OHZXp8ZWNkqoyOtaKacXVRhHtNqodbfFpYl3NiMH1/IGx1NlZYmYmJuZ2bQ0E6MDAqazw5alRbhVpRRWZiM2dmOj4/nYeHs5uZPz9ALElUN0ZTajY/jDg/hGZMi2ZIRTk2poyLp5aWRlVZMmJvNGl6SDs/VjU2Vkk/oY5jdXdeuaGYspychH1/i4yMlJCOloWBk4F9lIWCopqOoqCPzLGpvZWfwYmQ05qU2LOs0qOj0Z+jy5ihwJKfu5GbyqKlzaKsx5ylx6umxauow6amx6qow6SkuZebupmb1rOv3b+70LOxzLWuyrStzbew18K42cK50bexzbKs2r215s3A2MC1xrCmwKqkv6uj0b6y6tbI6tHG27mz4MG23Laz1rKw1ruz1bi0x6qqz7Cw48XA2bm3t5Cb17ewyp2gy5ujyp6k06etz6OovoqZv36VpHWHnHmEvZaZt5WQxZyawI+SvY2PxpmUu4uLsHd9nnd8m4CCooaB",
        "rI2DqouDuJmMv6OSy66g276w1rawxqSju5qes5uik316WVBHdmFSkWpZmGZekXJyb297Zm58amZ3oo6dloN9UFEyYlgtjmY1bT07fE5FKmBuLWFzRl9vl4+emn99Mi8nJyUdVSskVz9Gbkk/PVxfQGZwUlRjnJGgmn59OjAtLDlCMTVBXCUvfCs0eVxIgWFSV1FepJSijXp7NkI+JU5aKVdqQywvVCsuXEk/noZegH1utaKnl4GEa2RhdW9ugHh2iW5piW1rjnV1o5WKpp+Xxq2zoXiJqGZ4xHh9zpaayYuWx4aYwIKdt4isto6yxKG2sYOVsHmTuo+aupCfuY2ev5WjvZKltY+oupiw0a+8y6Giv5Oev5ygwJ6kx6Wp0bOz07W4zK+4y6661ri/2rWozaikupmatJKZupyfzrSy5MzI5MjJ2LS/3LzAypWZxZCbyZ6hyJqlvpChxpqr3LW/0qq6tpCs07K5tXyHt3iMuH2Rxomew4efrHSVqmyVlW6QoYKZyKKrond0rXt/qHF7rXR+u4GIsHiCo2h6l3J/q42MtZqZ",
        "wKKhxqWozrOy0bq328TA6dLP58rL2re7z6etxKKkvaCnhHJ1nYOEuIuKwIiLtY6TiYeUdnyKeGp3uZSfwKWse3Frj3hst4R3lllmn2RuN2qALGN7Rllqpo2awqKrT0NIPzQzfEZLdF5xj2FrQG2GNGd9UUJKp4eTvqGrSkBKPkVUUD9LgTpGmkZUjWdqjVZRVzw/q4mUsZmoQ1FrNVx2Q1tsUjE2YC8yY0JBpoF3c3Z7s5ihup2rf3qPg4iajoiQjXd7jHN5jHmFnJuqnKe2vqStwZerx4eZ3Jic4bK23KKs3Jyr1pOpzo6qypCqvpKjzaCyzJSpz6auzaawy6Gt0KayzJ+tw5GkyJqpx6Cs3Li/06m00bC0z6+107S43sLD3sHD17W71LK5zKuz48jG2ru7zK6vw6Opyauu28DA7tfV7dHT4brA07O42a211qex17O216+3z6Kv1am258TM3rXDw5Gpz6yzxpWiy5CizZal16Cx1Z6ww4ijwn+hrHqZq4Gbu5KjqYWKvJCZu4mVvoqUyJadwY2Ytn2OqYOVqYycmH2F",
        "xZ+YxJ2Wyqqg0Las3cW97NTL7MvH2rKtzaOf0Kqms5WVaVJZg2t7t3SCqnWHh3B1fWZvhXB/jHB3wZ2es5agWzlObDpQiVdqmVVtbUFbcj5Slk1kplhmxp+fwpynZ0dTVkNPVFJgcHKHa2R6cIaix56t32Fqz5ObyaOwsV1rrFRkmkpWoEJQyl9nr2t30l1h2lJY1ZijrZqrZ1uDcFNwoE9av1BYyE9VyVth1HyA36Wn4rm/spmngHaTkImer5ihw6Swy56q0qaz17PA2rbC4Li/vpOlxIOX1ZKX2q6z1Z6q0pOlzImiwoWkxIqo0qKyzZ2wypSsxqKryKOuw5ypyaOux5yqvI6hw5mp3bO83rvC1bC90LO5zrC20rW33MHB3cHB17e81Le94b/D48jH2b3AxquvvqCmwKKl1bm37NPR7NDS3rbA5sPG2au12aq62bnA2LO8z6Ow06Wy4rzE2LLBtpCq3rvAz6Wq0p+wzZiv2J+01Z6wxIahwXebpnSVq4Kb1rG5sJWUxaSlv5GbwJCayZqewo6WuIKPq4eUtpqguKCh",
        "vJ+gxqOky6un07as38K67NHL6MS/z56XwouGwIZ8wp2iomNoqmtxt3B+uXSEuH+RroGanIObmHWIt4KEy6Cot15ovl5mwldvsEFhjUVoX2aRc3udsWBvvYKEzaGsk0tpnGZ8snyNvFZin1VlZoulkJup4ISJ0JabzKStfVtwkkpivkpnskRLrFFbiYiatK61uJ2py6CrwqKpmYybiVxxmD9Mjz5Hp01UmV1vqJmrv6y227O3v5+nspukt5mhyo6Or3qAtH+Fy4qTwZWlyqWy3rS4wZWiyIeT1ZCQ3amq2Jui1I+a0YqazI6jzJSp16OszJ+qzpWixZudyJ2iwJKax5mexpScvoyZxZmk3rG117W21aquy6mnyaWly6im17ex1LOu0aur0Kyu4ru728C62rmyx6ahuZaVx6Wh2bqx683C68rC37a16MG90KWn1aKmyJ+bzZ6dz5qe056j4bSx3a6vwJGf3ra0vo2SzZCayo2W0ZGZzo2WvXuMvXGGqm+ApneGyJedlnRzs4WFs36Bsnl8vYKCtXp8qm5zn3B0n3h+oXx8"
      ]
    },
    {
      "id": "vault-ana-dragonite",
      "localId": "ANA",
      "name": "カイリュー",
      "nameEn": "Dragonite",
      "pokedexNumber": "149",
      "set": {
        "id": "ANA",
        "name": "1998 ANA Airline Promo"
      },
      "variants": {
        "normal": true
      },
      "image": "https://dlnxybxfzkpeatkjcztb.supabase.co/storage/v1/object/public/website-images/cards-fish/a356ad08-ba77-4f04-a4de-f6003c913b15-1737524278162",
      "marketUrl": "https://www.cardmarket.com/en/Pokemon/Products/Singles/Unnumbered-Promos/Dragonite-V2-UNP",
      "marketLabel": "View ANA Dragonite on Cardmarket ↗",
      "priceSnapshot": true,
      "pricing": {
        "cardmarket": { "idProduct": 654099, "updated": "2026-11-07T01:45:48.000Z", "trend": 114.96 }
      },
      "localOnly": true,
      "fingerprint": "3d6Hxr5f1+OzytmpxNKX0tmTz9CFwsRywcB/1NGQw8BUfqmosq9gorSVo7aWucqnuMqkn6qAoJ97ysySxsqJl7CVb6jeca3hcK/icLDmcLDob63lf6GlurVux8eKi7/Nd6K2e3JlTHNhTZOiZ6nSeJ+viLawurRry86PyeLQw5A0rXMZYYpsfqijuZI/jsTSwtW2u7dtzdKXy+TMorm4d10tu5lF1JAcrZdYsub3xdnCwb1xytGWtc61stHUaHyBl6yno7yxlJeEtdHYvtGrysl6ydahqKpno59RqKZcoqZhn6dpmqNnoaFYn6Fey9CDx9ats6etr6iotri6s7nAtLbBs8nJrM3UqtLl0uKdzeLEq8/enMXVlMPTj73NlLvLosnVqdbnqtntz+Wn1ObApMHHlbG6m8nVkLrFnMXTocjSotDekLnJ0um0zNqspsbUkLjNp9bro8bPsMnHpMO7nsDAp8jC1OvDyMuRnI+Ygq3HlcTYtdHYscjJosO4oL+0pL64yOC939iGr7Z7rr2Yv8qSx8p8x8h6wMFzv8JqsLRl3uWg"
    }
  ]
};
