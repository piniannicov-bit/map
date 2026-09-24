const map = L.map("map", {
    zoomControl: true
}).setView([20, 0], 3);


// ---------------------------------------------------------
// MAP LAYERS
// ---------------------------------------------------------

const standardLayer = L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        maxZoom: 19,
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }
);

const satelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
        maxZoom: 19,
        attribution:
            "Tiles &copy; Esri"
    }
);


const savedMapType =
    localStorage.getItem("mapType") || "standard";

if (savedMapType === "satellite") {
    satelliteLayer.addTo(map);
} else {
    standardLayer.addTo(map);
}


const standardMapButton =
    document.getElementById("standardMapButton");

const satelliteMapButton =
    document.getElementById("satelliteMapButton");


function updateMapButtons(type) {
    standardMapButton.classList.toggle(
        "active",
        type === "standard"
    );

    satelliteMapButton.classList.toggle(
        "active",
        type === "satellite"
    );
}


updateMapButtons(savedMapType);


standardMapButton.onclick = () => {

    map.removeLayer(satelliteLayer);

    standardLayer.addTo(map);

    localStorage.setItem(
        "mapType",
        "standard"
    );

    updateMapButtons("standard");
};


satelliteMapButton.onclick = () => {

    map.removeLayer(standardLayer);

    satelliteLayer.addTo(map);

    localStorage.setItem(
        "mapType",
        "satellite"
    );

    updateMapButtons("satellite");
};


// ---------------------------------------------------------
// STATE
// ---------------------------------------------------------

let currentPosition = null;
let destination = null;

let destinationMarker = null;
let userMarker = null;

let routeLine = null;
let trackingLine = null;

let trackingPoints = [];

let watchId = null;

let routeStarted = false;

let currentRouteGeometry = [];

let rerouteTimer = null;

let lastRouteRequest = 0;


// ---------------------------------------------------------
// DOM
// ---------------------------------------------------------

const locationStatus =
    document.getElementById("locationStatus");

const destinationStatus =
    document.getElementById("destinationStatus");

const distanceStatus =
    document.getElementById("distanceStatus");

const timeStatus =
    document.getElementById("timeStatus");

const speedStatus =
    document.getElementById("speedStatus");

const startButton =
    document.getElementById("startButton");

const finishButton =
    document.getElementById("finishButton");

const clearButton =
    document.getElementById("clearButton");

const myLocationButton =
    document.getElementById("myLocationButton");

const segmentsContainer =
    document.getElementById("segmentsContainer");


// ---------------------------------------------------------
// GEOLOCATION
// ---------------------------------------------------------

function startWatchingLocation() {

    if (!navigator.geolocation) {

        locationStatus.textContent =
            "GPS недоступен";

        return;
    }

    watchId =
        navigator.geolocation.watchPosition(
            handlePosition,
            handleLocationError,
            {
                enableHighAccuracy: true,
                maximumAge: 2000,
                timeout: 10000
            }
        );
}


function handlePosition(position) {

    const coords = position.coords;

    currentPosition = {
        lat: coords.latitude,
        lng: coords.longitude,
        accuracy: coords.accuracy,
        speed: coords.speed
    };


    locationStatus.textContent =
        `${coords.latitude.toFixed(5)}, ` +
        `${coords.longitude.toFixed(5)}`;


    const speed =
        coords.speed == null
            ? 0
            : coords.speed * 3.6;


    speedStatus.textContent =
        `${speed.toFixed(1)} км/ч`;


    updateUserMarker();


    if (routeStarted) {

        trackingPoints.push({
            lat: coords.latitude,
            lng: coords.longitude,
            accuracy: coords.accuracy,
            timestamp: Date.now()
        });

        updateTrackingLine();

        updateRouteProgress();

        maybeRecalculateRoute();
    }
}


function handleLocationError(error) {

    if (error.code === 1) {

        locationStatus.textContent =
            "Доступ к GPS запрещён";

    } else {

        locationStatus.textContent =
            "Не удалось определить позицию";
    }
}


function updateUserMarker() {

    if (!currentPosition) {
        return;
    }


    if (!userMarker) {

        userMarker = L.circleMarker(
            [
                currentPosition.lat,
                currentPosition.lng
            ],
            {
                radius: 8,
                color: "#ffffff",
                weight: 3,
                fillColor: "#1683ff",
                fillOpacity: 1
            }
        ).addTo(map);

    } else {

        userMarker.setLatLng([
            currentPosition.lat,
            currentPosition.lng
        ]);
    }
}


// ---------------------------------------------------------
// MAP CLICK — DESTINATION
// ---------------------------------------------------------

map.on("click", async (event) => {

    if (routeStarted) {
        return;
    }

    destination = {
        lat: event.latlng.lat,
        lng: event.latlng.lng
    };


    if (destinationMarker) {
        map.removeLayer(destinationMarker);
    }


    destinationMarker =
        L.marker([
            destination.lat,
            destination.lng
        ])
        .addTo(map)
        .bindPopup("Точка назначения")
        .openPopup();


    destinationStatus.textContent =
        `${destination.lat.toFixed(5)}, ` +
        `${destination.lng.toFixed(5)}`;


    if (currentPosition) {
        await requestRoute();
    }
});


// ---------------------------------------------------------
// ROUTING
// ---------------------------------------------------------

async function requestRoute() {

    if (!currentPosition || !destination) {
        return;
    }


    const now = Date.now();

    if (now - lastRouteRequest < 4000) {
        return;
    }

    lastRouteRequest = now;


    try {

        const response =
            await fetch("/api/route", {

                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    start: {
                        lat:
                            currentPosition.lat,

                        lng:
                            currentPosition.lng
                    },

                    end: destination
                })
            });


        const data =
            await response.json();


        if (!response.ok) {

            console.error(data);

            return;
        }


        currentRouteGeometry =
            data.geometry;


        if (routeLine) {
            map.removeLayer(routeLine);
        }


        routeLine =
            L.polyline(
                data.geometry,
                {
                    color: "#1683ff",
                    weight: 6,
                    opacity: 0.8
                }
            ).addTo(map);


        updateDistance(
            data.distance
        );

        updateTime(
            data.duration
        );

    } catch (error) {

        console.error(
            "Routing error:",
            error
        );
    }
}


function updateDistance(distance) {

    if (distance < 1000) {

        distanceStatus.textContent =
            `${Math.round(distance)} м`;

    } else {

        distanceStatus.textContent =
            `${(distance / 1000).toFixed(2)} км`;
    }
}


function updateTime(seconds) {

    const minutes =
        Math.round(seconds / 60);


    if (minutes < 1) {

        timeStatus.textContent =
            "меньше минуты";

    } else if (minutes < 60) {

        timeStatus.textContent =
            `${minutes} мин`;

    } else {

        const hours =
            Math.floor(minutes / 60);

        const mins =
            minutes % 60;

        timeStatus.textContent =
            `${hours} ч ${mins} мин`;
    }
}


// ---------------------------------------------------------
// START ROUTE
// ---------------------------------------------------------

startButton.onclick = async () => {

    if (!currentPosition) {

        alert(
            "Сначала дождись определения местоположения."
        );

        return;
    }


    if (!destination) {

        alert(
            "Сначала выбери точку на карте."
        );

        return;
    }


    trackingPoints = [];

    routeStarted = true;


    trackingPoints.push({
        lat: currentPosition.lat,
        lng: currentPosition.lng,
        accuracy: currentPosition.accuracy,
        timestamp: Date.now()
    });


    if (trackingLine) {
        map.removeLayer(trackingLine);
    }


    trackingLine =
        L.polyline(
            [],
            {
                color: "#ff3b67",
                weight: 5,
                opacity: 0.9
            }
        ).addTo(map);


    startButton.style.display =
        "none";

    finishButton.style.display =
        "block";


    segmentsContainer.innerHTML = "";


    await requestRoute();


    rerouteTimer =
        setInterval(
            () => {

                if (routeStarted) {
                    requestRoute();
                }

            },
            10000
        );
};


// ---------------------------------------------------------
// TRACKING
// ---------------------------------------------------------

function updateTrackingLine() {

    if (!trackingLine) {
        return;
    }


    trackingLine.setLatLngs(
        trackingPoints.map(point => [
            point.lat,
            point.lng
        ])
    );
}


// ---------------------------------------------------------
// ROUTE PROGRESS
// ---------------------------------------------------------

function updateRouteProgress() {

    if (!destination || !currentPosition) {
        return;
    }


    // Немедленное приблизительное расстояние
    // до цели по прямой.

    const directDistance =
        haversine(
            currentPosition.lat,
            currentPosition.lng,
            destination.lat,
            destination.lng
        );


    if (directDistance < 30) {

        distanceStatus.textContent =
            "Вы у цели";
    }
}


function maybeRecalculateRoute() {

    if (!routeStarted) {
        return;
    }

    requestRoute();
}


// ---------------------------------------------------------
// FINISH ROUTE
// ---------------------------------------------------------

finishButton.onclick = async () => {

    if (!routeStarted) {
        return;
    }


    routeStarted = false;


    if (rerouteTimer) {

        clearInterval(
            rerouteTimer
        );

        rerouteTimer = null;
    }


    finishButton.style.display =
        "none";

    startButton.style.display =
        "block";


    if (trackingPoints.length < 2) {

        alert(
            "Маршрут слишком короткий."
        );

        return;
    }


    const loggedIn =
        await isLoggedIn();


    if (!loggedIn) {

        alert(
            "Для сохранения маршрута необходимо войти в аккаунт."
        );

        return;
    }


    try {

        const response =
            await fetch(
                "/api/routes",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        destination,

                        points:
                            trackingPoints,

                        route_geometry:
                            currentRouteGeometry
                    })
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            alert(
                data.error ||
                "Не удалось сохранить маршрут."
            );

            return;
        }


        alert(
            "Маршрут сохранён!"
        );


        loadHistory();


    } catch (error) {

        console.error(error);

        alert(
            "Ошибка сохранения маршрута."
        );
    }
};


// ---------------------------------------------------------
// CLEAR
// ---------------------------------------------------------

clearButton.onclick = () => {

    routeStarted = false;

    destination = null;

    trackingPoints = [];

    currentRouteGeometry = [];


    if (destinationMarker) {

        map.removeLayer(
            destinationMarker
        );

        destinationMarker = null;
    }


    if (routeLine) {

        map.removeLayer(
            routeLine
        );

        routeLine = null;
    }


    if (trackingLine) {

        map.removeLayer(
            trackingLine
        );

        trackingLine = null;
    }


    destinationStatus.textContent =
        "Нажми на карту";

    distanceStatus.textContent =
        "—";

    timeStatus.textContent =
        "—";

    speedStatus.textContent =
        "—";

    segmentsContainer.innerHTML =
        "";

    startButton.style.display =
        "block";

    finishButton.style.display =
        "none";
};


// ---------------------------------------------------------
// MY LOCATION
// ---------------------------------------------------------

myLocationButton.onclick = () => {

    if (!currentPosition) {
        return;
    }


    map.setView(
        [
            currentPosition.lat,
            currentPosition.lng
        ],
        16
    );
};


// ---------------------------------------------------------
// HISTORY
// ---------------------------------------------------------

const historyButton =
    document.getElementById(
        "historyButton"
    );

const historyPanel =
    document.getElementById(
        "historyPanel"
    );

const historyList =
    document.getElementById(
        "historyList"
    );


historyButton.onclick = () => {

    const visible =
        historyPanel.style.display ===
        "block";


    historyPanel.style.display =
        visible
            ? "none"
            : "block";


    if (!visible) {
        loadHistory();
    }
};


async function loadHistory() {

    historyList.textContent =
        "Загрузка...";


    try {

        const response =
            await fetch(
                "/api/routes"
            );


        const data =
            await response.json();


        if (!response.ok) {

            historyList.textContent =
                data.error ||
                "Не удалось загрузить маршруты.";

            return;
        }


        if (!data.length) {

            historyList.textContent =
                "У тебя пока нет завершённых маршрутов.";

            return;
        }


        historyList.innerHTML = "";


        data.forEach(route => {

            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "history-item";


            const distance =
                route.distance_m >= 1000
                    ? `${(
                        route.distance_m / 1000
                    ).toFixed(2)} км`
                    : `${Math.round(
                        route.distance_m
                    )} м`;


            const duration =
                formatDuration(
                    route.duration_s
                );


            const date =
                new Date(
                    route.created_at
                ).toLocaleString(
                    "ru-RU"
                );


            item.innerHTML = `
                <strong>${distance}</strong><br>
                <span style="opacity:.65">
                    ${duration} · ${date}
                </span>
            `;


            item.onclick = () =>
                showCompletedRoute(
                    route.id
                );


            historyList.appendChild(
                item
            );
        });


    } catch (error) {

        console.error(error);

        historyList.textContent =
            "Ошибка загрузки.";
    }
}


// ---------------------------------------------------------
// SHOW COMPLETED ROUTE
// ---------------------------------------------------------

async function showCompletedRoute(
    routeId
) {

    try {

        const response =
            await fetch(
                `/api/routes/${routeId}`
            );


        const route =
            await response.json();


        if (!response.ok) {

            alert(
                route.error ||
                "Не удалось открыть маршрут."
            );

            return;
        }


        if (route.route_geometry?.length) {

            if (routeLine) {
                map.removeLayer(routeLine);
            }


            routeLine =
                L.polyline(
                    route.route_geometry,
                    {
                        color: "#1683ff",
                        weight: 6,
                        opacity: .8
                    }
                ).addTo(map);


            map.fitBounds(
                routeLine.getBounds(),
                {
                    padding: [40, 40]
                }
            );
        }


        if (trackingLine) {
            map.removeLayer(trackingLine);
        }


        if (route.points?.length) {

            trackingLine =
                L.polyline(
                    route.points.map(
                        point => [
                            point.lat,
                            point.lng
                        ]
                    ),
                    {
                        color: "#ff3b67",
                        weight: 5
                    }
                ).addTo(map);
        }


        showSegments(
            route.segments || [],
            route.points || []
        );


        historyPanel.style.display =
            "none";


    } catch (error) {

        console.error(error);
    }
}


// ---------------------------------------------------------
// SEGMENTS
// ---------------------------------------------------------

function showSegments(
    segments,
    points
) {
    segmentsContainer.innerHTML = `
        <h3>Участки маршрута</h3>
    `;

    segments.forEach(
        (segment, index) => {

            const element =
                document.createElement("div");

            element.className =
                "segment";

            element.innerHTML = `
                <strong>
                    Участок ${index + 1}
                </strong>

                <br>

                Средняя скорость:
                <b>
                    ${segment.average_speed_kmh}
                    км/ч
                </b>

                <br>

                Расстояние:
                ${formatDistance(
                    segment.distance_m
                )}

                <br>

                Время:
                ${formatDuration(
                    segment.duration_s
                )}
            `;

            element.onclick = () => {

                if (!points.length) {
                    return;
                }

                const segmentPoints =
                    points.slice(
                        segment.start_index,
                        segment.end_index + 1
                    );

                if (segmentPoints.length < 2) {
                    return;
                }

                const line =
                    L.polyline(
                        segmentPoints.map(
                            point => [
                                point.lat,
                                point.lng
                            ]
                        ),
                        {
                            color: "#ffd23f",
                            weight: 9,
                            opacity: 0.95
                        }
                    ).addTo(map);

                map.fitBounds(
                    line.getBounds(),
                    {
                        padding: [50, 50]
                    }
                );

                setTimeout(() => {
                    map.removeLayer(line);
                }, 4000);
            };

            segmentsContainer.appendChild(
                element
            );
        }
    );
}


// ---------------------------------------------------------
// AUTH
// ---------------------------------------------------------

const authButton =
    document.getElementById("authButton");

const authModal =
    document.getElementById("authModal");

const closeAuthButton =
    document.getElementById("closeAuthButton");

const loginButton =
    document.getElementById("loginButton");

const registerButton =
    document.getElementById("registerButton");

const usernameInput =
    document.getElementById("usernameInput");

const passwordInput =
    document.getElementById("passwordInput");

const authMessage =
    document.getElementById("authMessage");


authButton.onclick = async () => {

    const me =
        await fetch("/api/me")
            .then(response =>
                response.json()
            );

    if (me.authenticated) {

        if (
            confirm(
                `Вы вошли как ${me.username}. Выйти?`
            )
        ) {

            await fetch(
                "/api/logout",
                {
                    method: "POST"
                }
            );

            updateAuthButton();
        }

        return;
    }

    authMessage.textContent = "";

    authModal.style.display = "flex";
};


closeAuthButton.onclick = () => {

    authModal.style.display = "none";
};


loginButton.onclick = async () => {

    await authenticate(
        "/api/login"
    );
};


registerButton.onclick = async () => {

    await authenticate(
        "/api/register"
    );
};


async function authenticate(endpoint) {

    const username =
        usernameInput.value.trim();

    const password =
        passwordInput.value;

    if (!username || !password) {

        authMessage.textContent =
            "Заполни оба поля.";

        return;
    }

    try {

        const response =
            await fetch(
                endpoint,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        username,
                        password
                    })
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            authMessage.textContent =
                data.error ||
                "Ошибка.";

            return;
        }

        authMessage.textContent =
            "Готово!";

        authModal.style.display =
            "none";

        usernameInput.value = "";
        passwordInput.value = "";

        updateAuthButton();

    } catch (error) {

        console.error(error);

        authMessage.textContent =
            "Ошибка соединения.";
    }
}


async function updateAuthButton() {

    try {

        const response =
            await fetch("/api/me");

        const data =
            await response.json();

        if (data.authenticated) {

            authButton.textContent =
                data.username;

        } else {

            authButton.textContent =
                "Войти";
        }

    } catch (error) {

        console.error(error);
    }
}


async function isLoggedIn() {

    try {

        const response =
            await fetch("/api/me");

        const data =
            await response.json();

        return data.authenticated;

    } catch {

        return false;
    }
}


// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

function formatDistance(meters) {

    if (meters < 1000) {

        return `${Math.round(meters)} м`;
    }

    return `${(
        meters / 1000
    ).toFixed(2)} км`;
}


function formatDuration(seconds) {

    seconds =
        Math.round(seconds);

    const hours =
        Math.floor(
            seconds / 3600
        );

    const minutes =
        Math.floor(
            (seconds % 3600) / 60
        );

    if (hours > 0) {

        return `${hours} ч ${minutes} мин`;
    }

    return `${minutes} мин`;
}


function haversine(
    lat1,
    lng1,
    lat2,
    lng2
) {

    const R = 6371000;

    const p1 =
        lat1 * Math.PI / 180;

    const p2 =
        lat2 * Math.PI / 180;

    const dp =
        (lat2 - lat1)
        * Math.PI / 180;

    const dl =
        (lng2 - lng1)
        * Math.PI / 180;

    const a =
        Math.sin(dp / 2) ** 2
        +
        Math.cos(p1)
        *
        Math.cos(p2)
        *
        Math.sin(dl / 2) ** 2;

    return 2 * R *
        Math.asin(
            Math.sqrt(a)
        );
}


// ---------------------------------------------------------
// INIT
// ---------------------------------------------------------

startWatchingLocation();

updateAuthButton();
   
