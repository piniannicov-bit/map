import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

let scene;
let camera;
let renderer;
let clock;

let playerCar;
let bots = [];

let selectedColor = "#1683ff";

let gameRunning = false;
let raceFinished = false;

let speed = 0;
let maxSpeed = 0;

let distanceTravelled = 0;

let raceStartTime = 0;
let raceTime = 0;

let lastFrameTime = performance.now();

const MAX_SPEED = 38;
const ACCELERATION = 22;
const BRAKING = 32;
const FRICTION = 8;

const TURN_SPEED = 2.2;

const LAP_LENGTH = 1000;
const TOTAL_LAPS = 3;

let currentLap = 1;

let keys = {
    left: false,
    right: false,
    gas: false,
    brake: false
};

let playerData = null;

let replayData = [];
let lastReplayRecord = 0;

/* =========================================================
   AUTH
========================================================= */

async function loadPlayer() {

    try {

        const response = await fetch("/api/me");

        if (!response.ok) {
            return;
        }

        playerData = await response.json();

        if (playerData && playerData.username) {
            document.getElementById("playerName").textContent =
                "👤 " + playerData.username;
        }

    } catch (error) {
        console.error("Auth error:", error);
    }
}


/* =========================================================
   THREE.JS INITIALIZATION
========================================================= */

function initGame() {

    scene = new THREE.Scene();

    scene.background = new THREE.Color(0x87bfff);

    scene.fog = new THREE.Fog(
        0x87bfff,
        180,
        700
    );


    camera = new THREE.PerspectiveCamera(
        65,
        window.innerWidth / window.innerHeight,
        0.1,
        1500
    );


    renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById("game"),
        antialias: true
    });

    renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, 2)
    );

    renderer.setSize(
        window.innerWidth,
        window.innerHeight
    );

    renderer.shadowMap.enabled = true;

    clock = new THREE.Clock();


    setupLighting();
    createWorld();

    window.addEventListener(
        "resize",
        onResize
    );

    animate();
}


/* =========================================================
   LIGHTING
========================================================= */

function setupLighting() {

    const ambient = new THREE.HemisphereLight(
        0xffffff,
        0x334455,
        2
    );

    scene.add(ambient);


    const sun = new THREE.DirectionalLight(
        0xffffff,
        3
    );

    sun.position.set(
        100,
        180,
        100
    );

    sun.castShadow = true;

    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;

    scene.add(sun);
}


/* =========================================================
   WORLD
========================================================= */

function createWorld() {

    createGround();

    createTrack();

    createStadium();

    createTrees();

    createStartLine();
}


/* =========================================================
   GROUND
========================================================= */

function createGround() {

    const geometry =
        new THREE.PlaneGeometry(
            1600,
            1600
        );

    const material =
        new THREE.MeshStandardMaterial({
            color: 0x246b38
        });

    const ground =
        new THREE.Mesh(
            geometry,
            material
        );

    ground.rotation.x =
        -Math.PI / 2;

    ground.receiveShadow = true;

    scene.add(ground);
}


/* =========================================================
   TRACK
========================================================= */

function createTrack() {

    const roadMaterial =
        new THREE.MeshStandardMaterial({
            color: 0x252525
        });


    // Main oval

    const road =
        new THREE.Mesh(
            new THREE.RingGeometry(
                130,
                190,
                96
            ),
            roadMaterial
        );

    road.rotation.x =
        -Math.PI / 2;

    road.position.y = 0.02;

    scene.add(road);


    // Inner grass

    const inner =
        new THREE.Mesh(
            new THREE.CircleGeometry(
                130,
                96
            ),
            new THREE.MeshStandardMaterial({
                color: 0x286f39
            })
        );

    inner.rotation.x =
        -Math.PI / 2;

    inner.position.y = 0.03;

    scene.add(inner);


    // Outer grass border

    const outer =
        new THREE.Mesh(
            new THREE.RingGeometry(
                190,
                260,
                96
            ),
            new THREE.MeshStandardMaterial({
                color: 0x286f39
            })
        );

    outer.rotation.x =
        -Math.PI / 2;

    outer.position.y = 0.01;

    scene.add(outer);


    createTrackLines();
}


/* =========================================================
   TRACK LINES
========================================================= */

function createTrackLines() {

    const material =
        new THREE.MeshBasicMaterial({
            color: 0xffffff
        });


    for (
        let angle = 0;
        angle < Math.PI * 2;
        angle += Math.PI / 16
    ) {

        const a =
            angle;

        const x =
            Math.cos(a) * 160;

        const z =
            Math.sin(a) * 160;


        const line =
            new THREE.Mesh(
                new THREE.BoxGeometry(
                    1,
                    0.04,
                    7
                ),
                material
            );

        line.position.set(
            x,
            0.08,
            z
        );

        line.rotation.y =
            -a;

        scene.add(line);
    }
}


/* =========================================================
   STADIUM
========================================================= */

function createStadium() {

    for (
        let i = 0;
        i < 24;
        i++
    ) {

        const angle =
            (i / 24) *
            Math.PI * 2;

        const x =
            Math.cos(angle) * 250;

        const z =
            Math.sin(angle) * 250;


        const stand =
            new THREE.Mesh(
                new THREE.BoxGeometry(
                    70,
                    18,
                    28
                ),
                new THREE.MeshStandardMaterial({
                    color: 0x46566b
                })
            );


        stand.position.set(
            x,
            9,
            z
        );

        stand.lookAt(
            0,
            0,
            0
        );

        stand.castShadow = true;

        scene.add(stand);


        // Seats

        for (
            let row = 0;
            row < 4;
            row++
        ) {

            const seats =
                new THREE.Mesh(
                    new THREE.BoxGeometry(
                        62,
                        1.5,
                        4
                    ),
                    new THREE.MeshStandardMaterial({
                        color:
                            row % 2 === 0
                                ? 0xd83b3b
                                : 0xffffff
                    })
                );

            seats.position.set(
                x,
                8 + row * 3,
                z
            );

            seats.lookAt(
                0,
                0,
                0
            );

            scene.add(seats);
        }
    }
}


/* =========================================================
   TREES
========================================================= */

function createTrees() {

    for (
        let i = 0;
        i < 70;
        i++
    ) {

        const angle =
            Math.random() *
            Math.PI * 2;

        const radius =
            290 +
            Math.random() * 300;


        const x =
            Math.cos(angle) * radius;

        const z =
            Math.sin(angle) * radius;


        const trunk =
            new THREE.Mesh(
                new THREE.CylinderGeometry(
                    1.5,
                    2,
                    12,
                    8
                ),
                new THREE.MeshStandardMaterial({
                    color: 0x6b4226
                })
            );

        trunk.position.set(
            x,
            6,
            z
        );


        const crown =
            new THREE.Mesh(
                new THREE.SphereGeometry(
                    7,
                    10,
                    10
                ),
                new THREE.MeshStandardMaterial({
                    color: 0x176b32
                })
            );

        crown.position.set(
            x,
            15,
            z
        );

        scene.add(trunk);
        scene.add(crown);
    }
}


/* =========================================================
   START LINE
========================================================= */

function createStartLine() {

    for (
        let i = -8;
        i < 8;
        i++
    ) {

        const square =
            new THREE.Mesh(
                new THREE.BoxGeometry(
                    10,
                    0.15,
                    5
                ),
                new THREE.MeshStandardMaterial({
                    color:
                        i % 2 === 0
                            ? 0xffffff
                            : 0x111111
                })
            );

        square.position.set(
            i * 10,
            0.12,
            0
        );

        scene.add(square);
    }
}


/* =========================================================
   PROCEDURAL CAR
========================================================= */

function createCar(color) {

    const car =
        new THREE.Group();


    const bodyMaterial =
        new THREE.MeshStandardMaterial({
            color: color,
            metalness: 0.45,
            roughness: 0.28
        });


    const darkMaterial =
        new THREE.MeshStandardMaterial({
            color: 0x101010,
            metalness: 0.2,
            roughness: 0.35
        });


    // Body

    const body =
        new THREE.Mesh(
            new THREE.BoxGeometry(
                5.5,
                1.4,
                9
            ),
            bodyMaterial
        );

    body.position.y =
        1.7;

    body.castShadow = true;

    car.add(body);


    // Cabin

    const cabin =
        new THREE.Mesh(
            new THREE.BoxGeometry(
                4.1,
                1.4,
                4
            ),
            darkMaterial
        );

    cabin.position.set(
        0,
        2.8,
        0.5
    );

    cabin.castShadow = true;

    car.add(cabin);


    // Hood

    const hood =
        new THREE.Mesh(
            new THREE.BoxGeometry(
                5,
                .5,
                2.5
            ),
            bodyMaterial
        );

    hood.position.set(
        0,
        2.1,
        -3.2
    );

    car.add(hood);


    // Rear wing

    const wing =
        new THREE.Mesh(
            new THREE.BoxGeometry(
                5.8,
                .3,
                1
            ),
            bodyMaterial
        );

    wing.position.set(
        0,
        3.3,
        3.7
    );

    car.add(wing);


    // Wheels

    const wheelGeometry =
        new THREE.CylinderGeometry(
            1.05,
            1.05,
            0.75,
            20
        );


    const wheelPositions = [
        [-2.9, 1.05, -2.8],
        [ 2.9, 1.05, -2.8],
        [-2.9, 1.05,  2.8],
        [ 2.9, 1.05,  2.8]
    ];


    wheelPositions.forEach(
        position => {

            const wheel =
                new THREE.Mesh(
                    wheelGeometry,
                    darkMaterial
                );

            wheel.rotation.z =
                Math.PI / 2;

            wheel.position.set(
                ...position
            );

            wheel.castShadow = true;

            car.add(wheel);
        }
    );


    return car;
}


/* =========================================================
   CREATE PLAYER
========================================================= */

function createPlayer() {

    playerCar =
        createCar(selectedColor);

    playerCar.position.set(
        0,
        0,
        155
    );

    playerCar.rotation.y =
        Math.PI;

    scene.add(playerCar);
}


/* =========================================================
   CREATE BOTS
========================================================= */

function createBots() {

    const colors = [
        "#ff2525",
        "#18c964",
        "#ffd21f",
        "#b23cff"
    ];


    for (
        let i = 0;
        i < 4;
        i++
    ) {

        const bot =
            createCar(
                colors[i]
            );


        const angle =
            Math.PI +
            (i + 1) * 0.04;


        bot.position.set(
            (i - 1.5) * 9,
            0,
            155 + i * 12
        );


        bot.rotation.y =
            Math.PI;


        bot.userData = {

            speed:
                22 +
                Math.random() * 7,

            angle:
                angle,

            distance:
                0,

            lane:
                i - 1.5
        };


        scene.add(bot);

        bots.push(bot);
    }
}


/* =========================================================
   START RACE
========================================================= */

async function startRace() {

    document.getElementById(
        "menu"
    ).style.display = "none";

    document.getElementById(
        "hud"
    ).style.display = "block";


    gameRunning = false;
    raceFinished = false;

    speed = 0;
    maxSpeed = 0;

    distanceTravelled = 0;

    currentLap = 1;

    replayData = [];

    bots.forEach(
        bot => scene.remove(bot)
    );

    bots = [];


    if (playerCar) {
        scene.remove(playerCar);
    }


    createPlayer();
    createBots();


    const countdown =
        document.getElementById(
            "countdown"
        );


    countdown.textContent = "3";

    await wait(1000);

    countdown.textContent = "2";

    await wait(1000);

    countdown.textContent = "1";

    await wait(1000);

    countdown.textContent = "GO!";

    gameRunning = true;

    raceStartTime =
        performance.now();

    await wait(600);

    countdown.textContent = "";
}


/* =========================================================
   UPDATE PLAYER
========================================================= */

function updatePlayer(delta) {

    if (!gameRunning) {
        return;
    }


    if (keys.gas) {

        speed +=
            ACCELERATION *
            delta;

    } else if (keys.brake) {

        speed -=
            BRAKING *
            delta;

    } else {

        if (speed > 0) {

            speed -=
                FRICTION *
                delta;

        }

        if (speed < 0) {
            speed = 0;
        }
    }


    speed =
        Math.max(
            0,
            Math.min(
                MAX_SPEED,
                speed
            )
        );


    if (speed > maxSpeed) {
        maxSpeed = speed;
    }


    const steering =
        (keys.left ? 1 : 0) -
        (keys.right ? 1 : 0);


    playerCar.rotation.y +=
        steering *
        TURN_SPEED *
        delta *
        (speed / MAX_SPEED);


    const direction =
        new THREE.Vector3(
            0,
            0,
            -1
        );

    direction.applyQuaternion(
        playerCar.quaternion
    );


    const movement =
        direction.multiplyScalar(
            speed * delta
        );


    playerCar.position.add(
        movement
    );


    distanceTravelled +=
        Math.abs(speed * delta);


    updateLap();

    recordReplay();
}


/* =========================================================
   LAP
========================================================= */

function updateLap() {

    const calculatedLap =
        Math.floor(
            distanceTravelled /
            LAP_LENGTH
        ) + 1;


    currentLap =
        Math.min(
            calculatedLap,
            TOTAL_LAPS
        );


    document.getElementById(
        "lap"
    ).textContent =
        `${currentLap}/${TOTAL_LAPS}`;


    if (
        distanceTravelled >=
        LAP_LENGTH * TOTAL_LAPS
    ) {

        finishRace();
    }
}


/* =========================================================
   BOTS
========================================================= */

function updateBots(delta) {

    bots.forEach(
        bot => {

            if (!gameRunning) {
                return;
            }


            const speed =
                bot.userData.speed;


            bot.userData.distance +=
                speed * delta;


            const distance =
                bot.userData.distance;


            const radius = 155;


            const angle =
                distance / radius;


            const lane =
                bot.userData.lane * 8;


            bot.position.x =
                Math.sin(angle) *
                (radius + lane);


            bot.position.z =
                Math.cos(angle) *
                (radius + lane);


            bot.position.y =
                0;


            bot.rotation.y =
                angle;
        }
    );
}


/* =========================================================
   POSITION
========================================================= */

function updatePosition() {

    if (!playerCar) {
        return;
    }


    const playerDistance =
        distanceTravelled;


    let position = 1;


    bots.forEach(
        bot => {

            if (
                bot.userData.distance >
                playerDistance
            ) {
                position++;
            }
        }
    );


    document.getElementById(
        "position"
    ).textContent =
        `${position}/5`;
}


/* =========================================================
   CAMERA
========================================================= */

function updateCamera() {

    if (!playerCar) {
        return;
    }


    const target =
        new THREE.Vector3(
            0,
            3,
            -8
        );


    target.applyQuaternion(
        playerCar.quaternion
    );


    target.add(
        playerCar.position
    );


    camera.position.lerp(
        target,
        0.08
    );


    const lookAt =
        playerCar.position.clone();


    lookAt.y += 2;


    camera.lookAt(
        lookAt
    );
}


/* =========================================================
   REPLAY RECORDING
========================================================= */

function recordReplay() {

    const now =
        performance.now();


    if (
        now -
        lastReplayRecord <
        150
    ) {
        return;
    }


    lastReplayRecord = now;


    if (!playerCar) {
        return;
    }


    replayData.push({

        t:
            Math.round(
                now -
                raceStartTime
            ),

        x:
            Number(
                playerCar.position.x.toFixed(2)
            ),

        y:
            Number(
                playerCar.position.y.toFixed(2)
            ),

        z:
            Number(
                playerCar.position.z.toFixed(2)
            ),

        rotation:
            Number(
                playerCar.rotation.y.toFixed(3)
            ),

        speed:
            Number(
                speed.toFixed(2)
            )
    });
}


/* =========================================================
   FINISH
========================================================= */

async function finishRace() {

    if (raceFinished) {
        return;
    }

    raceFinished = true;
    gameRunning = false;

    raceTime =
        performance.now() -
        raceStartTime;

    const position =
        calculateFinalPosition();

    document.getElementById(
        "finalPosition"
    ).textContent =
        `${position}/5`;

    document.getElementById(
        "finalTime"
    ).textContent =
        formatTime(
            raceTime
        );

    document.getElementById(
        "finalMaxSpeed"
    ).textContent =
        `${Math.round(maxSpeed * 3.6)} км/ч`;

    document.getElementById(
        "finalDistance"
    ).textContent =
        `${Math.round(distanceTravelled)} м`;

    document.getElementById(
        "finishPanel"
    ).style.display =
        "flex";

    await saveRace(
        position
    );
}


/* =========================================================
   FINAL POSITION
========================================================= */

function calculateFinalPosition() {

    let position = 1;

    bots.forEach(
        bot => {

            if (
                bot.userData.distance >
                distanceTravelled
            ) {
                position++;
            }
        }
    );

    return position;
}


/* =========================================================
   SAVE RACE
========================================================= */

async function saveRace(position) {

    try {

        await fetch(
            "/api/game/races",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({

                        car_color:
                            selectedColor,

                        position:
                            position,

                        total_players:
                            5,

                        time_ms:
                            Math.round(
                                raceTime
                            ),

                        max_speed:
                            Number(
                                maxSpeed.toFixed(2)
                            ),

                        distance:
                            Number(
                                distanceTravelled.toFixed(2)
                            ),

                        laps:
                            TOTAL_LAPS,

                        replay:
                            replayData

                    })
            }
        );

    } catch (error) {

        console.error(
            "Could not save race:",
            error
        );
    }
}


/* =========================================================
   UTILITIES
========================================================= */

function wait(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}


function formatTime(ms) {

    const totalSeconds =
        Math.floor(ms / 1000);

    const minutes =
        Math.floor(
            totalSeconds / 60
        );

    const seconds =
        totalSeconds % 60;

    return (
        minutes +
        ":" +
        String(seconds)
            .padStart(2, "0")
    );
}


/* =========================================================
   KEYBOARD
========================================================= */

window.addEventListener(
    "keydown",
    event => {

        if (
            event.key === "ArrowLeft" ||
            event.key.toLowerCase() === "a"
        ) {
            keys.left = true;
        }

        if (
            event.key === "ArrowRight" ||
            event.key.toLowerCase() === "d"
        ) {
            keys.right = true;
        }

        if (
            event.key === "ArrowUp" ||
            event.key.toLowerCase() === "w"
        ) {
            keys.gas = true;
        }

        if (
            event.key === "ArrowDown" ||
            event.key.toLowerCase() === "s"
        ) {
            keys.brake = true;
        }
    }
);


window.addEventListener(
    "keyup",
    event => {

        if (
            event.key === "ArrowLeft" ||
            event.key.toLowerCase() === "a"
        ) {
            keys.left = false;
        }

        if (
            event.key === "ArrowRight" ||
            event.key.toLowerCase() === "d"
        ) {
            keys.right = false;
        }

        if (
            event.key === "ArrowUp" ||
            event.key.toLowerCase() === "w"
        ) {
            keys.gas = false;
        }

        if (
            event.key === "ArrowDown" ||
            event.key.toLowerCase() === "s"
        ) {
            keys.brake = false;
        }
    }
);


/* =========================================================
   MOBILE CONTROLS
========================================================= */

function setupTouchButton(
    id,
    key
) {

    const button =
        document.getElementById(id);

    button.addEventListener(
        "pointerdown",
        event => {

            event.preventDefault();

            keys[key] = true;
        }
    );

    button.addEventListener(
        "pointerup",
        event => {

            event.preventDefault();

            keys[key] = false;
        }
    );

    button.addEventListener(
        "pointercancel",
        () => {
            keys[key] = false;
        }
    );

    button.addEventListener(
        "pointerleave",
        () => {
            keys[key] = false;
        }
    );
}


setupTouchButton(
    "left",
    "left"
);

setupTouchButton(
    "right",
    "right"
);

setupTouchButton(
    "gas",
    "gas"
);

setupTouchButton(
    "brake",
    "brake"
);


/* =========================================================
   COLOR SELECTION
========================================================= */

document
    .querySelectorAll(".color")
    .forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    document
                        .querySelectorAll(".color")
                        .forEach(
                            b =>
                                b.classList.remove(
                                    "selected"
                                )
                        );

                    button.classList.add(
                        "selected"
                    );

                    selectedColor =
                        button.dataset.color;
                }
            );
        }
    );


/* =========================================================
   BUTTONS
========================================================= */

document
    .getElementById("startRace")
    .addEventListener(
        "click",
        startRace
    );


document
    .getElementById("restartButton")
    .addEventListener(
        "click",
        () => {

            document.getElementById(
                "finishPanel"
            ).style.display =
                "none";

            startRace();
        }
    );


document
    .getElementById("backButton")
    .addEventListener(
        "click",
        () => {

            window.location.href = "/";
        }
    );


/* =========================================================
   ANIMATION
========================================================= */

function animate() {

    requestAnimationFrame(
        animate
    );

    const now =
        performance.now();

    const delta =
        Math.min(
            (now - lastFrameTime) / 1000,
            0.05
        );

    lastFrameTime = now;

    updatePlayer(delta);

    updateBots(delta);

    updatePosition();

    updateCamera();

    if (gameRunning) {

        const currentSpeed =
            Math.round(
                speed * 3.6
            );

        document.getElementById(
            "speed"
        ).textContent =
            currentSpeed;
    }

    renderer.render(
        scene,
        camera
    );
}


/* =========================================================
   RESIZE
========================================================= */

function onResize() {

    camera.aspect =
        window.innerWidth /
        window.innerHeight;

    camera.updateProjectionMatrix();

    renderer.setSize(
        window.innerWidth,
        window.innerHeight
    );
}


/* =========================================================
   START
========================================================= */

loadPlayer();

initGame();

  
