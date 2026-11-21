# Web hotel search evidence (spec 07), 2026-11-21

- Game: G09 Harbor City Tech (fictional). Searched as: **Mediacom Stadium, Drake University, Des Moines, Iowa** (stand-in).
- Mode: Aivana API. Time: 14.8 s.
- Result: **none_verified** (No hotel could be verified online. Use the data-pack hotels.). 0 hotel(s) kept.
- Web search + JSON form output: **worked together** (response_format was accepted).
- Sources field in Aivana's response: none (as the docs say).

Saved here: the request body and Aivana's response only. The API key is sent in a header and is not in either. No page text is saved: for each link only pass/fail and the reason.

## Links checked by the code

| Hotel | Link | Result |
|---|---|---|
| (none kept) | | |

## Kept hotels (after the code's checks)

```json
[]
```

## Request body sent to Aivana

```json
{
  "system": "Search the web for hotels for a college soccer team's away trip. Return up to 6 real hotels near the stadium that could host a team. For every hotel give the exact URL of each page you found it on (the hotel's own page or a listing page that names it). Never invent a hotel, link, price or distance. nightly_rate_usd: a nightly price only if a page shows one, else null. miles_to_stadium: only if a page states it, else null. bus_parking: 'yes' or 'no' only if a page says so, else 'unknown'. Do not estimate or calculate anything.",
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
  "id": "gen_f05b9e7c0638ab188458aa61",
  "request_id": "req_fb620b4945fff0efbb255f41",
  "answer": "{\"hotels\":[{\"name\":\"SureStay Hotel by Best Western Des Moines East\",\"address\":\"5825 NE 14th St, Des Moines, IA 50313\",\"nightly_rate_usd\":null,\"miles_to_stadium\":null,\"bus_parking\":\"unknown\",\"source_urls\":[\"https://www.bestwestern.com/en_US/book/hotels-in-des-moines/surestay-hotel-by-best-western-des-moines-east/property-code.16075.html\"]},{\"name\":\"Holiday Inn Express & Suites Des Moines Downtown, an IHG Hotel\",\"address\":\"333 SW 11th St, Des Moines, IA 50309\",\"nightly_rate_usd\":null,\"miles_to_stadium\":null,\"bus_parking\":\"unknown\",\"source_urls\":[\"https://www.ihg.com/holidayinnexpress/hotels/us/en/des-moines/dsmex/hoteldetail\"]},{\"name\":\"Hyatt Place Des Moines / Downtown\",\"address\":\"418 6th Ave, Des Moines, IA 50309\",\"nightly_rate_usd\":null,\"miles_to_stadium\":null,\"bus_parking\":\"unknown\",\"source_urls\":[\"https://www.hyatt.com/hyatt-place/en-US/des-moines-downtown-dsmzd\"]},{\"name\":\"Des Moines Marriott Downtown\",\"address\":\"700 Grand Ave, Des Moines, IA 50309\",\"nightly_rate_usd\":null,\"miles_to_stadium\":null,\"bus_parking\":\"unknown\",\"source_urls\":[\"https://www.marriott.com/en-us/hotels/dsmia-des-moines-marriott-downtown/overview/\"]},{\"name\":\"Hilton Des Moines Downtown\",\"address\":\"435 Park St, Des Moines, IA 50309\",\"nightly_rate_usd\":null,\"miles_to_stadium\":null,\"bus_parking\":\"unknown\",\"source_urls\":[\"https://www.hilton.com/en/hotels/dsmddhh-hilton-des-moines-downtown/\"]},{\"name\":\"Renaissance Des Moines Savery Hotel\",\"address\":\"401 Locust St, Des Moines, IA 50309\",\"nightly_rate_usd\":null,\"miles_to_stadium\":null,\"bus_parking\":\"unknown\",\"source_urls\":[\"https://www.marriott.com/en-us/hotels/dsmbr-renaissance-des-moines-savery-hotel/overview/\"]}]}",
  "intent": {
    "name": "extract_json",
    "confidence": 0,
    "signal": ""
  },
  "structured": {
    "hotels": [
      {
        "name": "SureStay Hotel by Best Western Des Moines East",
        "address": "5825 NE 14th St, Des Moines, IA 50313",
        "nightly_rate_usd": null,
        "miles_to_stadium": null,
        "bus_parking": "unknown",
        "source_urls": [
          "https://www.bestwestern.com/en_US/book/hotels-in-des-moines/surestay-hotel-by-best-western-des-moines-east/property-code.16075.html"
        ]
      },
      {
        "name": "Holiday Inn Express & Suites Des Moines Downtown, an IHG Hotel",
        "address": "333 SW 11th St, Des Moines, IA 50309",
        "nightly_rate_usd": null,
        "miles_to_stadium": null,
        "bus_parking": "unknown",
        "source_urls": [
          "https://www.ihg.com/holidayinnexpress/hotels/us/en/des-moines/dsmex/hoteldetail"
        ]
      },
      {
        "name": "Hyatt Place Des Moines / Downtown",
        "address": "418 6th Ave, Des Moines, IA 50309",
        "nightly_rate_usd": null,
        "miles_to_stadium": null,
        "bus_parking": "unknown",
        "source_urls": [
          "https://www.hyatt.com/hyatt-place/en-US/des-moines-downtown-dsmzd"
        ]
      },
      {
        "name": "Des Moines Marriott Downtown",
        "address": "700 Grand Ave, Des Moines, IA 50309",
        "nightly_rate_usd": null,
        "miles_to_stadium": null,
        "bus_parking": "unknown",
        "source_urls": [
          "https://www.marriott.com/en-us/hotels/dsmia-des-moines-marriott-downtown/overview/"
        ]
      },
      {
        "name": "Hilton Des Moines Downtown",
        "address": "435 Park St, Des Moines, IA 50309",
        "nightly_rate_usd": null,
        "miles_to_stadium": null,
        "bus_parking": "unknown",
        "source_urls": [
          "https://www.hilton.com/en/hotels/dsmddhh-hilton-des-moines-downtown/"
        ]
      },
      {
        "name": "Renaissance Des Moines Savery Hotel",
        "address": "401 Locust St, Des Moines, IA 50309",
        "nightly_rate_usd": null,
        "miles_to_stadium": null,
        "bus_parking": "unknown",
        "source_urls": [
          "https://www.marriott.com/en-us/hotels/dsmbr-renaissance-des-moines-savery-hotel/overview/"
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
  "latency_ms": 8317,
  "finish_reason": "stop",
  "notices": [],
  "pending_action": null,
  "trace": null
}
```
