# Web hotel search evidence (spec 07), 2026-11-21

- Game: G09 Harbor City Tech (fictional). Searched as: **Mediacom Stadium, Drake University, Des Moines, Iowa** (stand-in).
- Mode: Aivana API. Time: 15.1 s.
- Result: **ok**. 1 hotel(s) kept.
- Web search + JSON form output: **worked together** (response_format was accepted).
- Sources field in Aivana's response: none (as the docs say).

Saved here: the request body and Aivana's response only. The API key is sent in a header and is not in either. No page text is saved: for each link only pass/fail and the reason.

## Links checked by the code

| Hotel | Link | Result |
|---|---|---|
| W1 Surety Hotel | https://www.suretyhotel.com/ | pass |
| W1 Surety Hotel | https://www.catchdesmoines.com/listing/surety-hotel/1032/ | fail: page returned 404 |
| (dropped) Holiday Inn Express & Suites Des Moines Downtown | https://www.ihg.com/holidayinnexpress/hotels/us/en/des-moines/dsmex/hoteldetail | fail: page doesn't mention the hotel |
| (dropped) Holiday Inn Express & Suites Des Moines Downtown | https://www.catchdesmoines.com/listing/holiday-inn-express-%26-suites-des-moines-downtown/1020/ | fail: page returned 404 |
| (dropped) Hilton Des Moines Downtown | https://www.hilton.com/en/hotels/dsmhhdh-hilton-des-moines-downtown/ | fail: page returned 403 |
| (dropped) Hilton Des Moines Downtown | https://www.catchdesmoines.com/listing/hilton-des-moines-downtown/1017/ | fail: page returned 404 |
| (dropped) Hyatt Place Des Moines / Downtown | https://www.hyatt.com/en-US/hotel/iowa/hyatt-place-des-moines-downtown/dsmzd | fail: page returned 429 |
| (dropped) Hyatt Place Des Moines / Downtown | https://www.catchdesmoines.com/listing/hyatt-place-des-moines-downtown/1018/ | fail: page doesn't mention the hotel |
| (dropped) Renaissance Des Moines Savery Hotel | https://www.marriott.com/en-us/hotels/dsmbr-renaissance-des-moines-savery-hotel/overview/ | fail: page returned 403 |
| (dropped) Renaissance Des Moines Savery Hotel | https://www.catchdesmoines.com/listing/renaissance-des-moines-savery-hotel/1029/ | fail: page returned 404 |
| (dropped) Embassy Suites by Hilton Des Moines Downtown | https://www.hilton.com/en/hotels/dsmeses-embassy-suites-by-hilton-des-moines-downtown/ | fail: page returned 403 |
| (dropped) Embassy Suites by Hilton Des Moines Downtown | https://www.catchdesmoines.com/listing/embassy-suites-by-hilton-des-moines-downtown/1014/ | fail: page returned 404 |

## Kept hotels (after the code's checks)

```json
[
  {
    "hotel_id": "W1",
    "name": "Surety Hotel",
    "address": "206 6th Ave, Des Moines, IA 50309",
    "nightly_rate_usd": null,
    "miles_to_stadium": null,
    "bus_parking": "unknown",
    "sources": [
      {
        "url": "https://www.suretyhotel.com/",
        "ok": true,
        "reason": ""
      },
      {
        "url": "https://www.catchdesmoines.com/listing/surety-hotel/1032/",
        "ok": false,
        "reason": "page returned 404"
      }
    ]
  }
]
```

## Request body sent to Aivana

```json
{
  "system": "Search the web for hotels for a college soccer team's away trip. Return up to 6 real hotels near the stadium that could host a team. For every hotel give the exact URL of up to 3 pages you found it on that name the hotel and can be read without logging in. Prefer pages that load as plain web pages: the hotel's own independent website, the city's visitor bureau listing, or the university's visitor/athletics travel page. Big chain booking pages often block automated checks, so add a second page for those. Never invent a hotel, link, price or distance. nightly_rate_usd: a nightly price only if a page shows one, else null. miles_to_stadium: only if a page states it, else null. bus_parking: 'yes' or 'no' only if a page says so, else 'unknown'. Do not estimate or calculate anything.",
  "messages": [
    {
      "role": "user",
      "content": "{\"find_hotels_near\":\"Mediacom Stadium, Drake University\",\"city\":\"Des Moines, Iowa\",\"check_in\":\"2027-10-15\",\"check_out\":\"2027-10-16\",\"rooms_needed\":18}"
    }
  ],
  "response_format": {
    "type": "json_schema",
    "schema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "hotels"
      ],
      "properties": {
        "hotels": {
          "type": "array",
          "maxItems": 6,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "name",
              "address",
              "nightly_rate_usd",
              "miles_to_stadium",
              "bus_parking",
              "source_urls"
            ],
            "properties": {
              "name": {
                "type": "string"
              },
              "address": {
                "type": "string"
              },
              "nightly_rate_usd": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "miles_to_stadium": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "bus_parking": {
                "type": "string",
                "enum": [
                  "yes",
                  "no",
                  "unknown"
                ]
              },
              "source_urls": {
                "type": "array",
                "minItems": 1,
                "maxItems": 3,
                "items": {
                  "type": "string"
                }
              }
            }
          }
        }
      }
    }
  },
  "max_tokens": 1200,
  "effort": "low",
  "web_search": true
}
```

## Aivana's response

```json
{
  "id": "gen_72dc0a1290ced69e94022c47",
  "request_id": "req_7451a4027106f1bac22a2767",
  "answer": "{\"hotels\":[{\"name\":\"Holiday Inn Express & Suites Des Moines Downtown\",\"address\":\"333 SW 11th St, Des Moines, IA 50309\",\"nightly_rate_usd\":null,\"miles_to_stadium\":null,\"bus_parking\":\"unknown\",\"source_urls\":[\"https://www.ihg.com/holidayinnexpress/hotels/us/en/des-moines/dsmex/hoteldetail\",\"https://www.catchdesmoines.com/listing/holiday-inn-express-%26-suites-des-moines-downtown/1020/\"]},{\"name\":\"Hilton Des Moines Downtown\",\"address\":\"435 Park St, Des Moines, IA 50309\",\"nightly_rate_usd\":null,\"miles_to_stadium\":null,\"bus_parking\":\"unknown\",\"source_urls\":[\"https://www.hilton.com/en/hotels/dsmhhdh-hilton-des-moines-downtown/\",\"https://www.catchdesmoines.com/listing/hilton-des-moines-downtown/1017/\"]},{\"name\":\"Surety Hotel\",\"address\":\"206 6th Ave, Des Moines, IA 50309\",\"nightly_rate_usd\":null,\"miles_to_stadium\":null,\"bus_parking\":\"unknown\",\"source_urls\":[\"https://www.suretyhotel.com/\",\"https://www.catchdesmoines.com/listing/surety-hotel/1032/\"]},{\"name\":\"Hyatt Place Des Moines / Downtown\",\"address\":\"416 SW 3rd St, Des Moines, IA 50309\",\"nightly_rate_usd\":null,\"miles_to_stadium\":null,\"bus_parking\":\"unknown\",\"source_urls\":[\"https://www.hyatt.com/en-US/hotel/iowa/hyatt-place-des-moines-downtown/dsmzd\",\"https://www.catchdesmoines.com/listing/hyatt-place-des-moines-downtown/1018/\"]},{\"name\":\"Renaissance Des Moines Savery Hotel\",\"address\":\"401 Locust St, Des Moines, IA 50309\",\"nightly_rate_usd\":null,\"miles_to_stadium\":null,\"bus_parking\":\"unknown\",\"source_urls\":[\"https://www.marriott.com/en-us/hotels/dsmbr-renaissance-des-moines-savery-hotel/overview/\",\"https://www.catchdesmoines.com/listing/renaissance-des-moines-savery-hotel/1029/\"]},{\"name\":\"Embassy Suites by Hilton Des Moines Downtown\",\"address\":\"101 E Locust St, Des Moines, IA 50309\",\"nightly_rate_usd\":null,\"miles_to_stadium\":null,\"bus_parking\":\"unknown\",\"source_urls\":[\"https://www.hilton.com/en/hotels/dsmeses-embassy-suites-by-hilton-des-moines-downtown/\",\"https://www.catchdesmoines.com/listing/embassy-suites-by-hilton-des-moines-downtown/1014/\"]}]}",
  "intent": {
    "name": "extract_json",
    "confidence": 0,
    "signal": ""
  },
  "structured": {
    "hotels": [
      {
        "name": "Holiday Inn Express & Suites Des Moines Downtown",
        "address": "333 SW 11th St, Des Moines, IA 50309",
        "nightly_rate_usd": null,
        "miles_to_stadium": null,
        "bus_parking": "unknown",
        "source_urls": [
          "https://www.ihg.com/holidayinnexpress/hotels/us/en/des-moines/dsmex/hoteldetail",
          "https://www.catchdesmoines.com/listing/holiday-inn-express-%26-suites-des-moines-downtown/1020/"
        ]
      },
      {
        "name": "Hilton Des Moines Downtown",
        "address": "435 Park St, Des Moines, IA 50309",
        "nightly_rate_usd": null,
        "miles_to_stadium": null,
        "bus_parking": "unknown",
        "source_urls": [
          "https://www.hilton.com/en/hotels/dsmhhdh-hilton-des-moines-downtown/",
          "https://www.catchdesmoines.com/listing/hilton-des-moines-downtown/1017/"
        ]
      },
      {
        "name": "Surety Hotel",
        "address": "206 6th Ave, Des Moines, IA 50309",
        "nightly_rate_usd": null,
        "miles_to_stadium": null,
        "bus_parking": "unknown",
        "source_urls": [
          "https://www.suretyhotel.com/",
          "https://www.catchdesmoines.com/listing/surety-hotel/1032/"
        ]
      },
      {
        "name": "Hyatt Place Des Moines / Downtown",
        "address": "416 SW 3rd St, Des Moines, IA 50309",
        "nightly_rate_usd": null,
        "miles_to_stadium": null,
        "bus_parking": "unknown",
        "source_urls": [
          "https://www.hyatt.com/en-US/hotel/iowa/hyatt-place-des-moines-downtown/dsmzd",
          "https://www.catchdesmoines.com/listing/hyatt-place-des-moines-downtown/1018/"
        ]
      },
      {
        "name": "Renaissance Des Moines Savery Hotel",
        "address": "401 Locust St, Des Moines, IA 50309",
        "nightly_rate_usd": null,
        "miles_to_stadium": null,
        "bus_parking": "unknown",
        "source_urls": [
          "https://www.marriott.com/en-us/hotels/dsmbr-renaissance-des-moines-savery-hotel/overview/",
          "https://www.catchdesmoines.com/listing/renaissance-des-moines-savery-hotel/1029/"
        ]
      },
      {
        "name": "Embassy Suites by Hilton Des Moines Downtown",
        "address": "101 E Locust St, Des Moines, IA 50309",
        "nightly_rate_usd": null,
        "miles_to_stadium": null,
        "bus_parking": "unknown",
        "source_urls": [
          "https://www.hilton.com/en/hotels/dsmeses-embassy-suites-by-hilton-des-moines-downtown/",
          "https://www.catchdesmoines.com/listing/embassy-suites-by-hilton-des-moines-downtown/1014/"
        ]
      }
    ]
  },
  "structured_error": null,
  "models_used": [
    "aivana-mmi"
  ],
  "usage": {
    "input_tokens": 182,
    "output_tokens": 0,
    "cached_tokens": 0,
    "credits": 0.000182
  },
  "latency_ms": 9959,
  "finish_reason": "stop",
  "notices": [],
  "pending_action": null,
  "trace": null
}
```
