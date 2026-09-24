import os
import math
import uuid
from datetime import datetime, timezone

import requests
from flask import Flask, request, jsonify, session, send_from_directory
from pymongo import MongoClient
from werkzeug.security import generate_password_hash, check_password_hash


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
