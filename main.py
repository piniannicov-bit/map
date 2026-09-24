import os
import math
import uuid
from datetime import datetime, timezone

import requests
from flask import Flask, request, jsonify, session, send_from_directory
from pymongo import MongoClient
from werkzeug.security import generate_password_hash, check_password_hash
from bson import ObjectId
import threading
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=BASE_DIR)

app.config["SECRET_KEY"] = os.environ.get(
    "SECRET_KEY",
    "change-this-secret-key"
)

MONGODB_URI = os.environ.get("MONGODB_URI")

mongo_client = None
db = None
users_collection = None
routes_collection = None

if MONGODB_URI:
    try:
        mongo_client = MongoClient(
            MONGODB_URI,
            serverSelectionTimeoutMS=5000
        )

        mongo_client.admin.command("ping")

        db = mongo_client["world_tracker"]
        users_collection = db["users"]
        routes_collection = db["routes"]

        users_collection.create_index("username", unique=True)
        routes_collection.create_index(
            [("user_id", 1), ("created_at", -1)]
        )

        print("MongoDB connected successfully.")

    except Exception as e:
        print("MongoDB connection failed:", e)
        mongo_client = None
        db = None
        users_collection = None
        routes_collection = None
else:
    print("WARNING: MONGODB_URI is not configured.")

# ============================================================
# OPENSKY
# ============================================================

OPENSKY_API_URL = "https://opensky-network.org/api"
OPENSKY_TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/"
    "opensky-network/protocol/openid-connect/token"
)

OPENSKY_CLIENT_ID = os.getenv(
    "OPENSKY_CLIENT_ID"
)

OPENSKY_CLIENT_SECRET = os.getenv(
    "OPENSKY_CLIENT_SECRET"
)


_opensky_token = None
_opensky_token_expires_at = 0
_opensky_token_lock = threading.Lock()


def get_opensky_token():
    global _opensky_token
    global _opensky_token_expires_at

    # Anonymous mode if credentials are not configured.
    if not OPENSKY_CLIENT_ID or not OPENSKY_CLIENT_SECRET:
        return None

    now = time.time()

    if (
        _opensky_token
        and now < _opensky_token_expires_at
    ):
        return _opensky_token

    with _opensky_token_lock:

        now = time.time()

        if (
            _opensky_token
            and now < _opensky_token_expires_at
        ):
            return _opensky_token

        response = requests.post(
            OPENSKY_TOKEN_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": OPENSKY_CLIENT_ID,
                "client_secret": OPENSKY_CLIENT_SECRET
            },
            timeout=(10, 60)
        )

        response.raise_for_status()

        data = response.json()

        _opensky_token = data["access_token"]

        expires_in = int(
            data.get(
                "expires_in",
                1800
            )
        )

        # Refresh a little before expiration.
        _opensky_token_expires_at = (
            time.time()
            + max(
                60,
                expires_in - 60
            )
        )

        return _opensky_token


def opensky_headers():
    token = get_opensky_token()

    if token:
        return {
            "Authorization": f"Bearer {token}"
        }

    return {}

def get_opensky_states(
    lamin,
    lomin,
    lamax,
    lomax
):

    params = {
        "lamin": lamin,
        "lomin": lomin,
        "lamax": lamax,
        "lomax": lomax,
        "extended": 1
    }

    response = requests.get(
        f"{OPENSKY_API_URL}/states/all",
        params=params,
        headers=opensky_headers(),
        timeout=(10, 60)
    )

    # If OAuth token expired, refresh once.
    if response.status_code == 401:

        global _opensky_token
        global _opensky_token_expires_at

        _opensky_token = None
        _opensky_token_expires_at = 0

        response = requests.get(
            f"{OPENSKY_API_URL}/states/all",
            params=params,
            headers=opensky_headers(),
            timeout=(10, 60)
        )

    response.raise_for_status()

    return response.json()

@app.route("/radar")
def radar_page():
    return send_from_directory(
        app.root_path,
        "radar.html"
    )

@app.route("/radar.js")
def radar_js():
    return send_from_directory(
        app.root_path,
        "radar.js"
    )

@app.route("/api/radar/states")
def radar_states():

    try:

        lamin = float(
            request.args.get(
                "lamin"
            )
        )

        lomin = float(
            request.args.get(
                "lomin"
            )
        )

        lamax = float(
            request.args.get(
                "lamax"
            )
        )

        lomax = float(
            request.args.get(
                "lomax"
            )
        )

    except (
        TypeError,
        ValueError
    ):

        return jsonify({
            "error": "Некорректные координаты карты."
        }), 400


    # Basic protection against accidentally
    # requesting the entire globe.
    if lamin < -90 or lamin > 90:
        return jsonify({
            "error": "lamin должен быть от -90 до 90."
        }), 400

    if lamax < -90 or lamax > 90:
        return jsonify({
            "error": "lamax должен быть от -90 до 90."
        }), 400

    if lomin < -180 or lomin > 180:
        return jsonify({
            "error": "lomin должен быть от -180 до 180."
        }), 400

    if lomax < -180 or lomax > 180:
        return jsonify({
            "error": "lomax должен быть от -180 до 180."
        }), 400


    # Do not allow huge requests.
    area = abs(
        lamax - lamin
    ) * abs(
        lomax - lomin
    )


    if area > 1600:

        return jsonify({
            "error": (
                "Область карты слишком большая. "
                "Приблизьте карту."
            )
        }), 400


    try:

        data = get_opensky_states(
            lamin,
            lomin,
            lamax,
            lomax
        )


        states = data.get("states") or []


        aircraft = []


        for state in states:

            if len(state) < 18:
                continue


            latitude = state[6]
            longitude = state[5]


            if (
                latitude is None
                or longitude is None
            ):
                continue


            aircraft.append({

                "icao24": state[0],

                "callsign": (
                    state[1].strip()
                    if state[1]
                    else None
                ),

                "origin_country":
                    state[2],

                "time_position":
                    state[3],

                "last_contact":
                    state[4],

                "longitude":
                    longitude,

                "latitude":
                    latitude,

                "altitude":
                    state[7],

                "on_ground":
                    state[8],

                "velocity":
                    state[9],

                "true_track":
                    state[10],

                "vertical_rate":
                    state[11],

                "geo_altitude":
                    state[13],

                "squawk":
                    state[14],

                "position_source":
                    state[16],

                "category":
                    state[17]
            })


        return jsonify({

            "time":
                data.get("time"),

            "aircraft":
                aircraft,

            "count":
                len(aircraft)

        })


    except requests.HTTPError as error:

        response = getattr(
            error,
            "response",
            None
        )


        if response is not None:

            if response.status_code == 429:

                return jsonify({
                    "error": (
                        "OpenSky временно "
                        "ограничил количество запросов. "
                        "Попробуйте через несколько секунд."
                    )
                }), 429


            if response.status_code == 401:

                return jsonify({
                    "error": (
                        "Ошибка авторизации OpenSky."
                    )
                }), 502


        print(
            "OpenSky HTTP error:",
            error
        )


        return jsonify({
            "error":
                "OpenSky не вернул данные."
        }), 502


    except Exception as error:

        print(
            "Radar states error:",
            error
        )


        return jsonify({
            "error":
                "Ошибка получения данных радара."
        }), 500

@app.route("/api/radar/track/<icao24>")
def radar_track(icao24):

    icao24 = (
        icao24
        .strip()
        .lower()
    )


    # ICAO24 is a 6-character hexadecimal address.
    if (
        len(icao24) != 6
        or any(
            c not in "0123456789abcdef"
            for c in icao24
        )
    ):

        return jsonify({
            "error":
                "Некорректный ICAO24."
        }), 400


    try:

        params = {
            "icao24": icao24,
            "time": 0
        }


        response = requests.get(
            f"{OPENSKY_API_URL}/tracks/all",
            params=params,
            headers=opensky_headers(),
            timeout=20
        )


        if response.status_code == 401:

            global _opensky_token
            global _opensky_token_expires_at

            _opensky_token = None
            _opensky_token_expires_at = 0


            response = requests.get(
                f"{OPENSKY_API_URL}/tracks/all",
                params=params,
                headers=opensky_headers(),
                timeout=20
            )


        if response.status_code == 404:

            return jsonify({
                "error":
                    "Текущая траектория "
                    "для этого самолёта недоступна."
            }), 404


        response.raise_for_status()


        data = response.json()


        path = []


        for point in (
            data.get("path") or []
        ):

            if len(point) < 6:
                continue


            path.append({

                "time":
                    point[0],

                "latitude":
                    point[1],

                "longitude":
                    point[2],

                "altitude":
                    point[3],

                "true_track":
                    point[4],

                "on_ground":
                    point[5]
            })


        return jsonify({

            "icao24":
                data.get(
                    "icao24",
                    icao24
                ),

            "callsign":
                data.get(
                    "calllsign"
                ) or data.get(
                    "callsign"
                ),

            "startTime":
                data.get(
                    "startTime"
                ),

            "endTime":
                data.get(
                    "endTime"
                ),

            "path":
                path

        })


    except requests.HTTPError as error:

        print(
            "OpenSky track HTTP error:",
            error
        )


        return jsonify({
            "error":
                "OpenSky не смог предоставить траекторию."
        }), 502


    except Exception as error:

        print(
            "Radar track error:",
            error
        )


        return jsonify({
            "error":
                "Ошибка получения траектории."
        }), 500

# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------

def utc_now():
    return datetime.now(timezone.utc)


def require_database():
    if users_collection is None or routes_collection is None:
        return jsonify({
            "error": "MongoDB is not configured."
        }), 503

    return None


def current_user():
    if "user_id" not in session:
        return None

    if users_collection is None:
        return None

    return users_collection.find_one({
        "_id": session["user_id"]
    })


def haversine(lat1, lon1, lat2, lon2):
    radius = 6371000

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)

    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1)
        * math.cos(phi2)
        * math.sin(dlambda / 2) ** 2
    )

    return 2 * radius * math.asin(math.sqrt(a))


def calculate_total_distance(points):
    total = 0

    for i in range(1, len(points)):
        previous = points[i - 1]
        current = points[i]

        total += haversine(
            previous["lat"],
            previous["lng"],
            current["lat"],
            current["lng"]
        )

    return total


def calculate_segments(points):
    """
    Делит трек на участки при заметном изменении скорости.

    Скорость каждой точки берется из browser GPS.
    Если средняя скорость нового участка отличается
    примерно на 30%+, создается новый сегмент.

    Минимальная длительность участка: 20 секунд.
    """

    if len(points) < 2:
        return []

    enriched = []

    for i in range(1, len(points)):
        p1 = points[i - 1]
        p2 = points[i]

        time_diff = (
            p2["timestamp"] - p1["timestamp"]
        ) / 1000

        if time_diff <= 0:
            continue

        distance = haversine(
            p1["lat"],
            p1["lng"],
            p2["lat"],
            p2["lng"]
        )

        speed_mps = distance / time_diff
        speed_kmh = speed_mps * 3.6

        enriched.append({
            "index": i,
            "speed": speed_kmh,
            "distance": distance,
            "duration": time_diff
        })

    if not enriched:
        return []

    segments = []

    current_start = 0
    current_items = []

    def average_speed(items):
        if not items:
            return 0

        total_distance = sum(x["distance"] for x in items)
        total_time = sum(x["duration"] for x in items)

        if total_time <= 0:
            return 0

        return (total_distance / total_time) * 3.6

    for item in enriched:
        current_items.append(item)

        duration = sum(
            x["duration"] for x in current_items
        )

        current_average = average_speed(current_items)

        if (
            duration >= 20
            and len(current_items) >= 3
        ):
            difference = abs(
                item["speed"] - current_average
            )

            threshold = max(
                2.0,
                current_average * 0.30
            )

            if difference > threshold:
                previous_items = current_items[:-1]

                if previous_items:
                    avg = average_speed(previous_items)

                    segments.append({
                        "start_index": current_start,
                        "end_index": item["index"] - 1,
                        "average_speed_kmh": round(avg, 2),
                        "distance_m": round(
                            sum(
                                x["distance"]
                                for x in previous_items
                            ),
                            2
                        ),
                        "duration_s": round(
                            sum(
                                x["duration"]
                                for x in previous_items
                            )
                        )
                    })

                    current_start = item["index"] - 1
                    current_items = [item]

    if current_items:
        avg = average_speed(current_items)

        segments.append({
            "start_index": current_start,
            "end_index": enriched[-1]["index"],
            "average_speed_kmh": round(avg, 2),
            "distance_m": round(
                sum(
                    x["distance"]
                    for x in current_items
                ),
                2
            ),
            "duration_s": round(
                sum(
                    x["duration"]
                    for x in current_items
                )
            )
        })

    return segments


# ---------------------------------------------------------
# Frontend
# ---------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/app.js")
def javascript():
    return send_from_directory(BASE_DIR, "app.js")


# ---------------------------------------------------------
# Authentication
# ---------------------------------------------------------

@app.post("/api/register")
def register():
    db_error = require_database()

    if db_error:
        return db_error

    data = request.get_json(silent=True) or {}

    username = str(
        data.get("username", "")
    ).strip()

    password = str(
        data.get("password", "")
    )

    if len(username) < 3:
        return jsonify({
            "error": "Username must contain at least 3 characters."
        }), 400

    if len(username) > 30:
        return jsonify({
            "error": "Username is too long."
        }), 400

    if len(password) < 6:
        return jsonify({
            "error": "Password must contain at least 6 characters."
        }), 400

    existing = users_collection.find_one({
        "username": username.lower()
    })

    if existing:
        return jsonify({
            "error": "This username is already registered."
        }), 409

    user_id = str(uuid.uuid4())

    user = {
        "_id": user_id,
        "username": username.lower(),
        "password_hash": generate_password_hash(password),
        "created_at": utc_now()
    }

    users_collection.insert_one(user)

    session["user_id"] = user_id

    return jsonify({
        "success": True,
        "username": username.lower()
    })


@app.post("/api/login")
def login():
    db_error = require_database()

    if db_error:
        return db_error

    data = request.get_json(silent=True) or {}

    username = str(
        data.get("username", "")
    ).strip().lower()

    password = str(
        data.get("password", "")
    )

    user = users_collection.find_one({
        "username": username
    })

    if not user:
        return jsonify({
            "error": "Invalid username or password."
        }), 401

    if not check_password_hash(
        user["password_hash"],
        password
    ):
        return jsonify({
            "error": "Invalid username or password."
        }), 401

    session["user_id"] = user["_id"]

    return jsonify({
        "success": True,
        "username": user["username"]
    })


@app.post("/api/logout")
def logout():
    session.clear()

    return jsonify({
        "success": True
    })


@app.get("/api/me")
def me():
    user = current_user()

    if not user:
        return jsonify({
            "authenticated": False
        })

    return jsonify({
        "authenticated": True,
        "username": user["username"]
    })


# ---------------------------------------------------------
# Routing
# ---------------------------------------------------------

@app.post("/api/route")
def calculate_route():
    data = request.get_json(silent=True) or {}

    try:
        start_lat = float(data["start"]["lat"])
        start_lng = float(data["start"]["lng"])

        end_lat = float(data["end"]["lat"])
        end_lng = float(data["end"]["lng"])

    except (KeyError, TypeError, ValueError):
        return jsonify({
            "error": "Invalid coordinates."
        }), 400

    url = (
        "https://router.project-osrm.org/route/v1/driving/"
        f"{start_lng},{start_lat};"
        f"{end_lng},{end_lat}"
    )

    params = {
        "overview": "full",
        "geometries": "geojson",
        "steps": "false"
    }

    try:
        response = requests.get(
            url,
            params=params,
            timeout=15
        )

        response.raise_for_status()

        result = response.json()

    except Exception as e:
        print("Routing error:", e)

        return jsonify({
            "error": "Could not calculate route."
        }), 502

    if result.get("code") != "Ok":
        return jsonify({
            "error": "Route could not be calculated."
        }), 400

    route = result["routes"][0]

    geometry = [
        [point[1], point[0]]
        for point in route["geometry"]["coordinates"]
    ]

    return jsonify({
        "distance": route["distance"],
        "duration": route["duration"],
        "geometry": geometry
    })


# ---------------------------------------------------------
# Save completed route
# ---------------------------------------------------------

@app.post("/api/routes")
def save_route():
    db_error = require_database()

    if db_error:
        return db_error

    user = current_user()

    if not user:
        return jsonify({
            "error": "Authentication required."
        }), 401

    data = request.get_json(silent=True) or {}

    points = data.get("points", [])
    destination = data.get("destination")
    route_geometry = data.get("route_geometry", [])

    if not isinstance(points, list):
        return jsonify({
            "error": "Invalid points."
        }), 400

    if len(points) < 2:
        return jsonify({
            "error": "The route must contain at least two GPS points."
        }), 400

    cleaned_points = []

    for point in points:
        try:
            cleaned_points.append({
                "lat": float(point["lat"]),
                "lng": float(point["lng"]),
                "timestamp": int(point["timestamp"]),
                "accuracy": float(
                    point.get("accuracy", 0)
                )
            })
        except (KeyError, TypeError, ValueError):
            continue

    if len(cleaned_points) < 2:
        return jsonify({
            "error": "No valid GPS points."
        }), 400

    total_distance = calculate_total_distance(
        cleaned_points
    )

    start_time = cleaned_points[0]["timestamp"]
    end_time = cleaned_points[-1]["timestamp"]

    total_duration = max(
        0,
        (end_time - start_time) / 1000
    )

    segments = calculate_segments(
        cleaned_points
    )

    route_document = {
        "_id": str(uuid.uuid4()),
        "user_id": user["_id"],
        "created_at": utc_now(),

        "destination": destination,

        "points": cleaned_points,

        "route_geometry": route_geometry,

        "distance_m": round(
            total_distance,
            2
        ),

        "duration_s": round(
            total_duration
        ),

        "segments": segments
    }

    routes_collection.insert_one(
        route_document
    )

    return jsonify({
        "success": True,
        "route_id": route_document["_id"]
    })


# ---------------------------------------------------------
# Route history
# ---------------------------------------------------------

@app.get("/api/routes")
def get_routes():
    db_error = require_database()

    if db_error:
        return db_error

    user = current_user()

    if not user:
        return jsonify({
            "error": "Authentication required."
        }), 401

    routes = routes_collection.find(
        {
            "user_id": user["_id"]
        },
        {
            "points": 0
        }
    ).sort(
        "created_at",
        -1
    ).limit(50)

    result = []

    for route in routes:
        result.append({
            "id": route["_id"],
            "created_at": route["created_at"].isoformat(),
            "destination": route.get("destination"),
            "distance_m": route.get("distance_m", 0),
            "duration_s": route.get("duration_s", 0),
            "segments": route.get("segments", []),
            "route_geometry": route.get(
                "route_geometry",
                []
            )
        })

    return jsonify(result)


@app.get("/api/routes/<route_id>")
def get_route(route_id):
    db_error = require_database()

    if db_error:
        return db_error

    user = current_user()

    if not user:
        return jsonify({
            "error": "Authentication required."
        }), 401

    route = routes_collection.find_one({
        "_id": route_id,
        "user_id": user["_id"]
    })

    if not route:
        return jsonify({
            "error": "Route not found."
        }), 404

    route.pop("_id", None)
    route.pop("user_id", None)

    if route.get("created_at"):
        route["created_at"] = route[
            "created_at"
        ].isoformat()

    return jsonify(route)

# ============================================================
# GAME
# ============================================================

@app.route("/game")
def game_page():
    return send_from_directory(".", "game.html")


@app.route("/game.js")
def game_js():
    return send_from_directory(".", "game.js")


@app.route("/api/game/races", methods=["POST"])
def save_game_race():

    if "user_id" not in session:
        return jsonify({
            "error": "Authentication required"
        }), 401

    if db is None:
        return jsonify({
            "error": "MongoDB is not connected"
        }), 503

    data = request.get_json(silent=True) or {}

    try:

        race = {
            "user_id": ObjectId(session["user_id"]),

            "created_at": datetime.utcnow(),

            "car_color":
                data.get(
                    "car_color",
                    "#1683ff"
                ),

            "position":
                int(
                    data.get(
                        "position",
                        1
                    )
                ),

            "total_players":
                int(
                    data.get(
                        "total_players",
                        5
                    )
                ),

            "time_ms":
                int(
                    data.get(
                        "time_ms",
                        0
                    )
                ),

            "max_speed":
                float(
                    data.get(
                        "max_speed",
                        0
                    )
                ),

            "distance":
                float(
                    data.get(
                        "distance",
                        0
                    )
                ),

            "laps":
                int(
                    data.get(
                        "laps",
                        3
                    )
                ),

            "replay":
                data.get(
                    "replay",
                    []
                )
        }


        result = db.game_races.insert_one(
            race
        )


        return jsonify({
            "success": True,
            "race_id": str(
                result.inserted_id
            )
        })

    except Exception as e:

        print(
            "Game race save error:",
            e
        )

        return jsonify({
            "error": "Could not save race"
        }), 500


@app.route("/api/game/races", methods=["GET"])
def get_game_races():

    if "user_id" not in session:
        return jsonify({
            "error": "Authentication required"
        }), 401

    if db is None:
        return jsonify({
            "error": "MongoDB is not connected"
        }), 503

    try:

        races = list(
            db.game_races
            .find({
                "user_id":
                    ObjectId(
                        session["user_id"]
                    )
            })
            .sort(
                "created_at",
                -1
            )
            .limit(50)
        )


        result = []

        for race in races:

            result.append({

                "id":
                    str(
                        race["_id"]
                    ),

                "created_at":
                    race.get(
                        "created_at"
                    ).isoformat()
                    if race.get(
                        "created_at"
                    )
                    else None,

                "car_color":
                    race.get(
                        "car_color"
                    ),

                "position":
                    race.get(
                        "position",
                        1
                    ),

                "total_players":
                    race.get(
                        "total_players",
                        5
                    ),

                "time_ms":
                    race.get(
                        "time_ms",
                        0
                    ),

                "max_speed":
                    race.get(
                        "max_speed",
                        0
                    ),

                "distance":
                    race.get(
                        "distance",
                        0
                    ),

                "laps":
                    race.get(
                        "laps",
                        3
                    )
            })


        return jsonify(result)

    except Exception as e:

        print(
            "Game race history error:",
            e
        )

        return jsonify({
            "error": "Could not load races"
        }), 500


@app.route(
    "/api/game/races/<race_id>",
    methods=["GET"]
)
def get_game_race(race_id):

    if "user_id" not in session:
        return jsonify({
            "error": "Authentication required"
        }), 401

    if db is None:
        return jsonify({
            "error": "MongoDB is not connected"
        }), 503

    try:

        race = db.game_races.find_one({
            "_id":
                ObjectId(race_id),

            "user_id":
                ObjectId(
                    session["user_id"]
                )
        })


        if not race:

            return jsonify({
                "error": "Race not found"
            }), 404


        return jsonify({

            "id":
                str(
                    race["_id"]
                ),

            "created_at":
                race.get(
                    "created_at"
                ).isoformat()
                if race.get(
                    "created_at"
                )
                else None,

            "car_color":
                race.get(
                    "car_color"
                ),

            "position":
                race.get(
                    "position",
                    1
                ),

            "total_players":
                race.get(
                    "total_players",
                    5
                ),

            "time_ms":
                race.get(
                    "time_ms",
                    0
                ),

            "max_speed":
                race.get(
                    "max_speed",
                    0
                ),

            "distance":
                race.get(
                    "distance",
                    0
                ),

            "laps":
                race.get(
                    "laps",
                    3
                ),

            "replay":
                race.get(
                    "replay",
                    []
                )
        })

    except Exception as e:

        print(
            "Game race error:",
            e
        )

        return jsonify({
            "error": "Could not load race"
        }), 500
# ---------------------------------------------------------
# Health check
# ---------------------------------------------------------

@app.get("/api/health")
def health():
    mongodb = False

    if mongo_client:
        try:
            mongo_client.admin.command("ping")
            mongodb = True
        except Exception:
            mongodb = False

    return jsonify({
        "status": "ok",
        "mongodb": mongodb
    })


# ---------------------------------------------------------
# Start
# ---------------------------------------------------------

if __name__ == "__main__":
    port = int(
        os.environ.get("PORT", 5000)
    )

    app.run(
        host="0.0.0.0",
        port=port,
        debug=True
)
