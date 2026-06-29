// Game Configuration & Levels
let levels = [];

let currentLevelIndex = 0;
let gameState = "IDLE"; // IDLE, SIMULATING, CRASHED, SUCCESS
let playerExpression = null;
let editingFuncIndex = -1; // -1 = adding new, >= 0 = editing existing
let currentX = -10;
const simulationSpeed = 3.5; // Math units per second
let curveOpacity = 0.3; // Low opacity preview by default, becomes 1.0 on PLAY

// Precalculated run results
let collisionDetected = false;
let collisionX = 999;
let collisionY = 0;
let crashReason = ""; // "OUT_OF_BOUNDS", "OBSTACLE", "UNDEFINED"
let activeRewards = [];

// Particle systems
let particles = [];

// DOM Elements
const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const mathDetails = document.getElementById("level-details-math");
const playButton = document.getElementById("play-button");
const resetButton = document.getElementById("reset-button");
const equationInput = document.getElementById("equation-input");
const addFuncButton = document.getElementById("add-func-button");

// Modal DOM elements
const endLevelModal = document.getElementById("end-level-modal");
const modalTitle = document.getElementById("modal-title");
const modalMessage = document.getElementById("modal-message");
const modalPrimaryBtn = document.getElementById("modal-primary-btn");
const modalSecondaryBtn = document.getElementById("modal-secondary-btn");

const infoModal = document.getElementById("info-modal");
const infoModalTitle = document.getElementById("info-modal-title");
const infoModalText = document.getElementById("info-modal-text");
const infoModalCloseBtn = document.getElementById("info-modal-close-btn");
const openInfoBtn = document.getElementById("open-info-btn");

// JSXGraph board, curve pointers, and multiple player functions list
let board = null;
let playerCurveElement = null;
let playerFunctions = [];

// Preload Tractor Images
const truckImages = [];
const framePaths = [
    "Animasyon/Traktör/frame0000.png",
    "Animasyon/Traktör/frame0001.png",
    "Animasyon/Traktör/frame0002.png",
    "Animasyon/Traktör/frame0003.png",
    "Animasyon/Traktör/frame0004.png"
];
let imagesLoaded = 0;
const targetTruckHeight = 50; // Pixels
const markerYOffset = 39; // Original Marker2D position (0, 39) in Godot

framePaths.forEach((path, idx) => {
    const img = new Image();
    img.src = path;
    img.onload = () => {
        imagesLoaded++;
        if (imagesLoaded === framePaths.length) {
            triggerRedraw();
        }
    };
    img.onerror = () => {
        console.warn("Tractor frame failed to load: " + path);
    };
    truckImages[idx] = img;
});

// Setup modal click bindings
modalPrimaryBtn.addEventListener("click", handleModalPrimaryAction);
modalSecondaryBtn.addEventListener("click", handleModalSecondaryAction);

openInfoBtn.addEventListener("click", showLevelInfoModal);
infoModalCloseBtn.addEventListener("click", hideLevelInfoModal);

playButton.addEventListener("click", startSimulation);
resetButton.addEventListener("click", () => resetSimulation(true));

window.addEventListener("resize", resizeCanvas);

// Bind input event to float textbox
equationInput.addEventListener("input", handleEquationInput);
equationInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        addCurrentFunction();
    }
});
const funcTypeSelect = document.getElementById("func-type-select");
if (funcTypeSelect) {
    funcTypeSelect.addEventListener("change", handleEquationInput);
}
addFuncButton.addEventListener("click", addCurrentFunction);

// -------------------------------------------------------------
// JSXGraph Engine Initialization & Input Handlers
// -------------------------------------------------------------

function initJSXGraph() {
    board = JXG.JSXGraph.initBoard('jxgbox', {
        boundingbox: [-10, 10, 10, -10],
        axis: true,
        grid: true,
        showCopyright: false,
        showNavigation: false,
        keepaspectratio: true,
        zoom: {
            factorX: 1.25,
            factorY: 1.25,
            wheel: true,
            needshift: false
        },
        pan: {
            needshift: false,
            enabled: true
        }
    });

    // Re-draw canvas overlay elements when grid is zoomed or panned
    board.on('update', () => {
        triggerRedraw();
    });
}

function updateEquationInputLatex() {
    const inputVal = equationInput.value;
    const renderDiv = document.getElementById("equation-latex-render");
    const previewDiv = document.getElementById("equation-live-preview");
    if (!renderDiv) return;
    
    if (inputVal.length === 0) {
        renderDiv.innerHTML = "";
        if (previewDiv) {
            previewDiv.classList.remove("visible");
            previewDiv.innerHTML = "";
        }
        return;
    }
    
    // Convert math keywords to KaTeX LaTeX command formats
    let latex = inputVal
        .replace(/\*/g, " \\cdot ")
        .replace(/sin/g, "\\sin")
        .replace(/cos/g, "\\cos")
        .replace(/tan/g, "\\tan")
        .replace(/abs/g, "\\text{abs}")
        .replace(/sqrt/g, "\\sqrt")
        .replace(/pi/g, "\\pi")
        .replace(/tau/g, "\\tau")
        .replace(/phi/g, "\\phi")
        .replace(/log/g, "\\log")
        .replace(/ln/g, "\\ln");
        
    try {
        katex.render(latex, renderDiv, {
            throwOnError: false,
            displayMode: false
        });
        
        if (previewDiv) {
            katex.render(latex, previewDiv, {
                throwOnError: false,
                displayMode: false
            });
            previewDiv.classList.add("visible");
        }
    } catch (err) {
        renderDiv.textContent = inputVal;
        if (previewDiv) {
            previewDiv.textContent = inputVal;
            previewDiv.classList.add("visible");
        }
    }
}

function handleEquationInput() {
    updateEquationInputLatex();
    
    if (gameState === "SIMULATING") return;
    
    const val = equationInput.value.trim();
    
    // Clear preview curve if empty input
    if (val.length === 0) {
        playerExpression = null;
        if (playerCurveElement) {
            board.removeObject(playerCurveElement);
            playerCurveElement = null;
        }
        triggerRedraw();
        return;
    }
    
    try {
        const parsed = parseExpression(val);
        if (parsed) {
            playerExpression = parsed;
            
            // Plot/update functiongraph in JSXGraph
            if (playerCurveElement) {
                board.removeObject(playerCurveElement);
            }
            const funcType = funcTypeSelect ? funcTypeSelect.value : "explicit";
            let displayExpression = playerExpression;
            
            if (funcType === "derivative") {
                const h = 0.0001;
                displayExpression = (x, yVal) => {
                    const y2 = playerExpression(x + h, yVal);
                    const y1 = playerExpression(x - h, yVal);
                    if (isNaN(y2) || isNaN(y1)) return (yVal === undefined) ? NaN : 999999;
                    return (y2 - y1) / (2 * h);
                };
            } else if (funcType === "integral") {
                displayExpression = (x, yVal) => {
                    const baseVal = playerExpression(0, yVal);
                    if (isNaN(baseVal) || baseVal === 999999) return (yVal === undefined) ? NaN : 999999;
                    const steps = Math.min(100, Math.ceil(Math.abs(x) / 0.1));
                    if (steps === 0) return 0;
                    const dx = x / steps;
                    let sum = 0;
                    let prevVal = baseVal;
                    for (let i = 1; i <= steps; i++) {
                        const t = i * dx;
                        const val = playerExpression(t, yVal);
                        if (isNaN(prevVal) || isNaN(val) || val === 999999) return (yVal === undefined) ? NaN : 999999;
                        sum += (prevVal + val) * 0.5 * dx;
                        prevVal = val;
                    }
                    return sum;
                };
            }
            
            if (funcType === "explicit" || funcType === "derivative" || funcType === "integral") {
                playerCurveElement = board.create('functiongraph', [displayExpression], {
                    strokeColor: '#2c72c0',
                    strokeWidth: 3,
                    strokeOpacity: 0.35,
                    dash: 2,
                    highlight: false
                });
            } else {
                playerCurveElement = board.create('implicitcurve', [(x, y) => displayExpression(x, y)], {
                    strokeColor: '#2c72c0',
                    strokeWidth: 3,
                    strokeOpacity: 0.35,
                    dash: 2,
                    highlight: false
                });
            }
            
            precalculateSimulation();
        }
    } catch (e) {
        playerExpression = null;
        if (playerCurveElement) {
            board.removeObject(playerCurveElement);
            playerCurveElement = null;
        }
    }
    
    triggerRedraw();
}

function updatePhysics(dt) {
    // Obsolete block physics loop
}

// -------------------------------------------------------------
// Math Parser & Sandbox Evaluator
// -------------------------------------------------------------
// -------------------------------------------------------------
// AST-Based Math Parser & Sandbox Evaluator (Desmos/GeoGebra Style)
// -------------------------------------------------------------

function tokenize(str) {
    const tokens = [];
    let i = 0;
    
    while (i < str.length) {
        const char = str[i];
        
        if (/\s/.test(char)) {
            i++;
            continue;
        }
        
        if ("+-*/()^%".includes(char)) {
            tokens.push({ type: 'OPERATOR', value: char });
            i++;
            continue;
        }
        
        // Numbers
        if (/\d/.test(char) || (char === '.' && i + 1 < str.length && /\d/.test(str[i+1]))) {
            let numStr = "";
            while (i < str.length && (/\d/.test(str[i]) || str[i] === '.')) {
                numStr += str[i];
                i++;
            }
            tokens.push({ type: 'NUMBER', value: parseFloat(numStr) });
            continue;
        }
        
        // Words (variables, constants, functions)
        if (/[a-zA-Z]/.test(char)) {
            let wordStr = "";
            while (i < str.length && /[a-zA-Z]/.test(str[i])) {
                wordStr += str[i];
                i++;
            }
            
            const lower = wordStr.toLowerCase();
            if (lower === "x" || lower === "y") {
                tokens.push({ type: 'VARIABLE', value: lower });
            } else if (lower === "pi" || lower === "e" || lower === "tau" || lower === "phi") {
                tokens.push({ type: 'CONSTANT', value: lower });
            } else if (["sin", "cos", "tan", "abs", "sqrt", "log", "ln"].includes(lower)) {
                tokens.push({ type: 'FUNCTION', value: lower });
            } else {
                throw new Error("Unknown word: " + wordStr);
            }
            continue;
        }
        
        throw new Error("Invalid character: " + char);
    }
    
    return tokens;
}

class ParserState {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }
    
    peek() {
        return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
    }
    
    next() {
        return this.pos < this.tokens.length ? this.tokens[this.pos++] : null;
    }
    
    consume(expectedValue) {
        const token = this.peek();
        if (!token || token.value !== expectedValue) {
            throw new Error(`Expected '${expectedValue}' but found '${token ? token.value : 'EOF'}'`);
        }
        this.pos++;
    }
    
    parse() {
        const node = this.parseExpression();
        if (this.pos < this.tokens.length) {
            throw new Error("Unexpected token: " + this.tokens[this.pos].value);
        }
        return node;
    }
    
    parseExpression() {
        let node = this.parseTerm();
        
        while (true) {
            const token = this.peek();
            if (token && token.type === 'OPERATOR' && (token.value === '+' || token.value === '-')) {
                this.next();
                const right = this.parseTerm();
                node = { type: 'BINARY', op: token.value, left: node, right: right };
            } else {
                break;
            }
        }
        return node;
    }
    
    parseTerm() {
        let node = this.parseFactor();
        
        while (true) {
            const token = this.peek();
            
            // Explicit multiplication or division
            if (token && token.type === 'OPERATOR' && (token.value === '*' || token.value === '/')) {
                this.next();
                const right = this.parseFactor();
                node = { type: 'BINARY', op: token.value, left: node, right: right };
            } 
            // Implicit multiplication (e.g. "3x", "2sin(x)", "(x+1)(x+2)")
            else if (token && (
                token.type === 'NUMBER' || 
                token.type === 'VARIABLE' || 
                token.type === 'CONSTANT' || 
                token.type === 'FUNCTION' || 
                (token.type === 'OPERATOR' && token.value === '(')
            )) {
                const right = this.parseFactor();
                node = { type: 'BINARY', op: '*', left: node, right: right };
            } else {
                break;
            }
        }
        return node;
    }
    
    parseFactor() {
        let node = this.parsePrimary();
        
        const token = this.peek();
        if (token && token.type === 'OPERATOR' && token.value === '^') {
            this.next();
            const right = this.parseFactor(); // Right-associative
            node = { type: 'BINARY', op: '^', left: node, right: right };
        }
        return node;
    }
    
    parsePrimary() {
        const token = this.peek();
        if (!token) {
            throw new Error("Unexpected end of expression");
        }
        
        if (token.type === 'OPERATOR' && (token.value === '-' || token.value === '+')) {
            this.next();
            const operand = this.parsePrimary();
            return { type: 'UNARY', op: token.value, operand: operand };
        }
        
        if (token.type === 'NUMBER') {
            this.next();
            return { type: 'NUMBER', value: token.value };
        }
        
        if (token.type === 'VARIABLE') {
            this.next();
            return { type: 'VARIABLE', value: token.value };
        }
        
        if (token.type === 'CONSTANT') {
            this.next();
            return { type: 'CONSTANT', value: token.value };
        }
        
        if (token.type === 'FUNCTION') {
            this.next();
            this.consume('(');
            const arg = this.parseExpression();
            this.consume(')');
            return { type: 'FUNCTION', name: token.value, arg: arg };
        }
        
        if (token.type === 'OPERATOR' && token.value === '(') {
            this.next();
            const node = this.parseExpression();
            this.consume(')');
            return node;
        }
        
        throw new Error("Unexpected token: " + token.value);
    }
}

function evaluateAST(node, xVal, yVal = 0) {
    if (node.type === 'NUMBER') {
        return node.value;
    }
    
    if (node.type === 'VARIABLE') {
        if (node.value === 'x') return xVal;
        if (node.value === 'y') return yVal;
        return 0;
    }
    
    if (node.type === 'CONSTANT') {
        const val = node.value.toLowerCase();
        if (val === 'pi') return Math.PI;
        if (val === 'e') return Math.E;
        if (val === 'tau') return Math.PI * 2;
        if (val === 'phi') return 1.618033988749895;
        return 0;
    }
    
    if (node.type === 'UNARY') {
        const val = evaluateAST(node.operand, xVal, yVal);
        return node.op === '-' ? -val : val;
    }
    
    if (node.type === 'BINARY') {
        const left = evaluateAST(node.left, xVal, yVal);
        const right = evaluateAST(node.right, xVal, yVal);
        
        switch (node.op) {
            case '+': return left + right;
            case '-': return left - right;
            case '*': return left * right;
            case '/': return left / right;
            case '^': return Math.pow(left, right);
            default: throw new Error("Unknown binary operator: " + node.op);
        }
    }
    
    if (node.type === 'FUNCTION') {
        const arg = evaluateAST(node.arg, xVal, yVal);
        switch (node.name) {
            case 'sin': return Math.sin(arg);
            case 'cos': return Math.cos(arg);
            case 'tan': return Math.tan(arg);
            case 'abs': return Math.abs(arg);
            case 'sqrt': return Math.sqrt(arg);
            case 'log': return Math.log10(arg);
            case 'ln': return Math.log(arg);
            default: throw new Error("Unknown function: " + node.name);
        }
    }
    
    throw new Error("Unknown AST node type: " + node.type);
}

// Helper to normalize equations (e.g. y = x -> x, x^2+y^2=16 -> (x^2+y^2)-(16))
function normalizeEquation(formulaStr) {
    let raw = formulaStr.trim();
    if (raw.includes('=')) {
        const parts = raw.split('=');
        if (parts.length === 2) {
            const lhs = parts[0].trim();
            const rhs = parts[1].trim();
            if (lhs === '0') {
                return rhs;
            } else if (rhs === '0') {
                return lhs;
            } else if (lhs.toLowerCase() === 'y' || lhs.toLowerCase() === 'f(x)') {
                return rhs;
            } else {
                return `(${lhs}) - (${rhs})`;
            }
        }
    }
    return raw;
}

function parseExpression(formulaStr) {
    const raw = normalizeEquation(formulaStr);
    if (raw.length === 0) return null;
    
    try {
        const tokens = tokenize(raw);
        const parser = new ParserState(tokens);
        const astRoot = parser.parse();
        
        const fn = (xVal, yVal) => {
            const val = evaluateAST(astRoot, xVal, yVal);
            const num = parseFloat(val);
            if (isNaN(num) || !isFinite(num) || Math.abs(num) > 200) {
                return (yVal === undefined) ? NaN : 999999;
            }
            return num;
        };
        
        // Test evaluate
        const test = fn(levels[currentLevelIndex].startX);
        return fn;
    } catch (e) {
        throw e;
    }
}

// -------------------------------------------------------------
// LaTeX Equations formatting for KaTeX
// -------------------------------------------------------------
function formatCircleLatex(pos, radius) {
    let xTerm = "";
    if (pos.x === 0) {
        xTerm = "x^2";
    } else {
        const sign = pos.x > 0 ? "-" : "+";
        xTerm = `(x ${sign} ${Math.abs(pos.x)})^2`;
    }
    
    let yTerm = "";
    if (pos.y === 0) {
        yTerm = "y^2";
    } else {
        const sign = pos.y > 0 ? "-" : "+";
        yTerm = `(y ${sign} ${Math.abs(pos.y)})^2`;
    }
    
    const r2 = Math.round(radius * radius * 100) / 100;
    return `${xTerm} + ${yTerm} = ${r2}`;
}

function formatCurveLatex(exprStr) {
    return "y = " + exprStr.toLowerCase()
        .replace(/\*\*/g, "^")
        .replace(/\*/g, " \\cdot ")
        .replace(/sin/g, "\\sin")
        .replace(/cos/g, "\\cos")
        .replace(/tan/g, "\\tan")
        .replace(/abs/g, "\\text{abs}")
        .replace(/sqrt/g, "\\sqrt");
}

function parseCircleEquation(eqStr) {
    const s = eqStr.replace(/\s+/g, '');
    let x0 = 0;
    let y0 = 0;
    let r2 = 0;
    
    const xMatch = s.match(/\(x([-+]\d+(?:\.\d+)?)\)\^2/);
    if (xMatch) {
        x0 = -parseFloat(xMatch[1]);
    } else if (s.includes("x^2")) {
        x0 = 0;
    }
    
    const yMatch = s.match(/\(y([-+]\d+(?:\.\d+)?)\)\^2/);
    if (yMatch) {
        y0 = -parseFloat(yMatch[1]);
    } else if (s.includes("y^2")) {
        y0 = 0;
    }
    
    const eqMatch = s.match(/=(\d+(?:\.\d+)?)/);
    if (eqMatch) {
        r2 = parseFloat(eqMatch[1]);
    }
    
    return {
        pos: { x: x0, y: y0 },
        radius: Math.sqrt(r2)
    };
}

// Helper to populate constraints info inside level panel
function addConstraintRow(parent, label, val) {
    const row = document.createElement("div");
    row.className = "constraint-item";
    
    const lblSpan = document.createElement("span");
    lblSpan.className = "constraint-label";
    lblSpan.textContent = label + ":";
    
    const valSpan = document.createElement("span");
    valSpan.className = "constraint-val";
    valSpan.textContent = val;
    
    row.appendChild(lblSpan);
    row.appendChild(valSpan);
    parent.appendChild(row);
}

// Dynamic Level Loading & UI Formatting
function loadLevel(index) {
    currentLevelIndex = index;
    const lvl = levels[index];
    
    // Set level header title & instructions inside the modal elements
    if (infoModalTitle && infoModalText) {
        infoModalTitle.textContent = lvl.name || `Level ${index + 1}`;
        infoModalText.textContent = lvl.instructions || "";
    }
    
    // Update combobox options based on level settings
    const funcTypeSelect = document.getElementById("func-type-select");
    if (funcTypeSelect) {
        funcTypeSelect.innerHTML = "";
        const enabled = lvl.constraints && lvl.constraints.enabledEquations ? lvl.constraints.enabledEquations : ["explicit", "implicit", "derivative", "integral"];
        
        const optionMap = {
            "explicit": { value: "explicit", text: "f(x) =" },
            "implicit": { value: "implicit", text: "0 =" },
            "derivative": { value: "derivative", text: "f'(x) =" },
            "integral": { value: "integral", text: "∫ f(x) dx =" }
        };
        
        enabled.forEach(key => {
            if (optionMap[key]) {
                const opt = document.createElement("option");
                opt.value = optionMap[key].value;
                opt.textContent = optionMap[key].text;
                funcTypeSelect.appendChild(opt);
            }
        });
        
        // Default select the first available option
        funcTypeSelect.value = enabled[0] || "explicit";
    }
    
    // Populate level constraints UI
    const constraintsDiv = document.getElementById("level-constraints");
    constraintsDiv.innerHTML = "";
    if (lvl.constraints) {
        const title = document.createElement("div");
        title.className = "constraint-title";
        title.textContent = "Level Constraints";
        constraintsDiv.appendChild(title);
        
        if (lvl.constraints.maxFunctions !== undefined && lvl.constraints.maxFunctions !== -1) {
            addConstraintRow(constraintsDiv, "Max Segments", `${lvl.constraints.maxFunctions}`);
        }
        if (lvl.constraints.forbiddenOperators && lvl.constraints.forbiddenOperators.length > 0) {
            addConstraintRow(constraintsDiv, "Forbidden Keys", lvl.constraints.forbiddenOperators.join(", "));
        }
        if (lvl.constraints.requireContinuous) {
            addConstraintRow(constraintsDiv, "Continuous Path", "Yes");
        }
        if (lvl.constraints.requireSmooth) {
            addConstraintRow(constraintsDiv, "Smooth Curves", "Yes");
        }
        if (lvl.constraints.maxArcLength !== undefined && lvl.constraints.maxArcLength !== -1) {
            addConstraintRow(constraintsDiv, "Max Path Length", `${lvl.constraints.maxArcLength} units`);
        }
        if (lvl.constraints.truckStartYLevel !== undefined && lvl.constraints.truckStartYLevel !== -1) {
            addConstraintRow(constraintsDiv, "Start Y Level", `${lvl.constraints.truckStartYLevel}`);
        }
        if (lvl.constraints.truckEndYLevel !== undefined && lvl.constraints.truckEndYLevel !== -1) {
            addConstraintRow(constraintsDiv, "Finish Y Level", `${lvl.constraints.truckEndYLevel}`);
        }
        constraintsDiv.style.display = "block";
    } else {
        constraintsDiv.style.display = "none";
    }
    
    if (!board) {
        initJSXGraph();
    } else {
        // Full board reset — clearObjects() doesn't reliably remove all elements;
        // freeBoard + re-init guarantees a truly clean slate
        JXG.JSXGraph.freeBoard(board);
        board = null;
        initJSXGraph();
    }
    
    // Set bounding box, preserving 1:1 aspect ratio
    board.setBoundingBox([lvl.xMin, lvl.yMax, lvl.xMax, lvl.yMin], true);
    playerCurveElement = null;
    playerFunctions = [];
    
    // Draw target start and end Y level dots on JSXGraph board if constraints are set
    if (lvl.constraints) {
        if (lvl.constraints.truckStartYLevel !== undefined && lvl.constraints.truckStartYLevel !== -1) {
            board.create('point', [lvl.startX, lvl.constraints.truckStartYLevel], {
                strokeColor: '#2ca02c',
                fillColor: '#2ca02c',
                size: 4,
                fixed: true,
                withLabel: false,
                highlight: false
            });
        }
        if (lvl.constraints.truckEndYLevel !== undefined && lvl.constraints.truckEndYLevel !== -1) {
            board.create('point', [lvl.finishX, lvl.constraints.truckEndYLevel], {
                strokeColor: '#2ca02c',
                fillColor: '#2ca02c',
                size: 4,
                fixed: true,
                withLabel: false,
                highlight: false
            });
        }
    }
    
    // Parse equations from json obstacles on the fly and plot them on JXG.Board
    lvl.obstacles.forEach((obs) => {
        const eqStr = obs.equation;
        const clean = eqStr.replace(/\s+/g, '').toLowerCase();
        
        if (clean.includes("x") && clean.includes("y") && clean.includes("^2")) {
            obs.type = "point"; // Normalized internally to "point" for collision detection
            const parsed = parseCircleEquation(eqStr);
            obs.pos = parsed.pos;
            obs.radius = parsed.radius;
            
            // Plot Circle obstacle in JXG Board
            board.create('circle', [[obs.pos.x, obs.pos.y], obs.radius], {
                strokeColor: '#a83232',
                strokeWidth: 4,
                fillColor: 'rgba(168, 50, 50, 0.08)',
                hasInnerPoints: false,
                fixed: true,
                highlight: false
            });
        } else {
            obs.type = "function";
            const parts = eqStr.split("=");
            obs.expressionString = parts.length > 1 ? parts[1].trim() : eqStr;
            try {
                obs.expression = parseExpression(obs.expressionString);
                
                // Plot Function obstacle with local domains/ranges in JXG Board
                const restrictedExpr = (xVal) => {
                    if (obs.xRange && (xVal < obs.xRange[0] || xVal > obs.xRange[1])) return NaN;
                    const yVal = obs.expression(xVal);
                    if (obs.yRange && (yVal < obs.yRange[0] || yVal > obs.yRange[1])) return NaN;
                    return yVal;
                };
                
                board.create('functiongraph', [restrictedExpr], {
                    strokeColor: '#a83232',
                    strokeWidth: 4,
                    fixed: true,
                    highlight: false
                });
            } catch (e) {
                console.error("Failed to parse level function obstacle: " + obs.expressionString);
            }
        }
    });
    
    // Render KaTeX Math details on the top panel
    updateMathDetailsPanel();
    
    // Reset equation input text box
    equationInput.value = "";
    if (typeof updateEquationInputLatex === "function") {
        updateEquationInputLatex();
    }
    
    // Safe inline state reset (board freed — don't call removeObject again)
    gameState = "IDLE";
    currentX = lvl.startX;
    particles = [];
    curveOpacity = 0.3;
    playerExpression = null;
    playerCurveElement = null;
    editingFuncIndex = -1;
    
    activeRewards = lvl.rewards.map(rwd => ({
        ...rwd,
        collected: false,
        animScale: 1.0,
        animAlpha: 1.0,
        isCollectable: false
    }));
    
    playButton.disabled = false;
    
    precalculateSimulation();
    
    // Refresh virtual keyboard disabled states for the level constraints
    if (typeof renderKeyboardLeft === "function") {
        renderKeyboardLeft("abc");
        updateKeyboardDisabledStates();
    }
    
    triggerRedraw();
}

// Render equations and player-defined function segments in the sidebar panel
function updateMathDetailsPanel() {
    const lvl = levels[currentLevelIndex];
    mathDetails.innerHTML = "";
    
    // 1. Obstacles (Red GeoGebra Rows)
    lvl.obstacles.forEach((obs) => {
        const row = document.createElement("div");
        row.className = "geogebra-row";
        
        const icon = document.createElement("div");
        icon.className = "geogebra-icon obstacle";
        
        const text = document.createElement("div");
        text.className = "geogebra-text math-render";
        
        if (obs.type === "point") {
            const eq = obs.equation;
            text.textContent = `\\(${eq}\\)`;
        } else if (obs.type === "function") {
            let eq = obs.equation;
            if (obs.xRange) {
                eq += `, ${obs.xRange[0].toFixed(1)} \\le x \\le ${obs.xRange[1].toFixed(1)}`;
            }
            if (obs.yRange) {
                eq += `, ${obs.yRange[0].toFixed(1)} \\le y \\le ${obs.yRange[1].toFixed(1)}`;
            }
            text.textContent = `\\(${eq}\\)`;
        }
        
        row.appendChild(icon);
        row.appendChild(text);
        mathDetails.appendChild(row);
    });
    
    // 2. Player Added Functions (Blue GeoGebra Rows with multiple editable intervals)
    playerFunctions.forEach((func, idx) => {
        const row = document.createElement("div");
        row.className = "geogebra-row player-func";
        
        // Header (Icon + Equation + Delete Segment)
        const header = document.createElement("div");
        header.className = "player-func-header";
        
        const icon = document.createElement("div");
        icon.className = "geogebra-icon player";
        
        const text = document.createElement("div");
        text.className = "geogebra-text math-render";
        const prefix = func.type === 'implicit' ? "0" 
                     : func.type === 'derivative' ? `f'_{${idx+1}}(x)` 
                     : func.type === 'integral' ? `\\int f_{${idx+1}}(x) dx` 
                     : `f_{${idx+1}}(x)`;
        text.textContent = `\\(${prefix} = ${func.expressionString}\\)`;
        
        // Edit button — loads expression back into input for modification
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "btn-edit-row" + (editingFuncIndex === idx ? " active" : "");
        editBtn.title = "Edit this function";
        editBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
        editBtn.addEventListener("click", () => {
            editingFuncIndex = idx;
            equationInput.value = func.expressionString;
            if (funcTypeSelect) funcTypeSelect.value = func.type || "explicit";
            equationInput.focus();
            updateEquationInputLatex();
            updateMathDetailsPanel(); // re-render to highlight active row
        });
        
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn-delete-row";
        delBtn.textContent = "×";
        delBtn.title = "Delete entire function";
        delBtn.addEventListener("click", () => {
            if (editingFuncIndex === idx) editingFuncIndex = -1;
            if (func.jxgElement && board) {
                try { board.removeObject(func.jxgElement); } catch(e) {}
            }
            playerFunctions.splice(idx, 1);
            updateMathDetailsPanel();
            precalculateSimulation();
            triggerRedraw();
        });
        
        header.appendChild(icon);
        header.appendChild(text);
        header.appendChild(delBtn);
        header.appendChild(editBtn);
        row.appendChild(header);
        
        // Highlight row if currently being edited
        if (editingFuncIndex === idx) {
            row.classList.add("editing");
        }
        
        // Intervals list container
        const grid = document.createElement("div");
        grid.className = "intervals-grid";
        
        // X-Intervals list
        const xContainer = document.createElement("div");
        xContainer.className = "interval-list-container";
        
        func.xRanges.forEach((range, rIdx) => {
            const rangeRow = document.createElement("div");
            rangeRow.className = "interval-row";
            
            const group = document.createElement("div");
            group.className = "range-inputs-group";
            group.innerHTML = '<span>x: [</span>';
            
            const minInput = document.createElement("input");
            minInput.className = "range-input";
            minInput.type = "text";
            minInput.value = range[0].toString();
            minInput.addEventListener("change", () => {
                const parsed = parseFloat(minInput.value);
                if (!isNaN(parsed)) {
                    range[0] = parsed;
                    board.update();
                    precalculateSimulation();
                    triggerRedraw();
                }
            });
            
            const maxInput = document.createElement("input");
            maxInput.className = "range-input";
            maxInput.type = "text";
            maxInput.value = range[1].toString();
            maxInput.addEventListener("change", () => {
                const parsed = parseFloat(maxInput.value);
                if (!isNaN(parsed)) {
                    range[1] = parsed;
                    board.update();
                    precalculateSimulation();
                    triggerRedraw();
                }
            });
            
            const delIntervalBtn = document.createElement("button");
            delIntervalBtn.type = "button";
            delIntervalBtn.className = "btn-delete-interval";
            delIntervalBtn.textContent = "×";
            delIntervalBtn.title = "Delete x interval";
            delIntervalBtn.addEventListener("click", () => {
                func.xRanges.splice(rIdx, 1);
                updateMathDetailsPanel();
                precalculateSimulation();
                board.update();
                triggerRedraw();
            });
            
            group.appendChild(minInput);
            group.appendChild(document.createTextNode(", "));
            group.appendChild(maxInput);
            group.appendChild(document.createTextNode("]"));
            
            rangeRow.appendChild(group);
            rangeRow.appendChild(delIntervalBtn);
            xContainer.appendChild(rangeRow);
        });
        
        const addXBtn = document.createElement("button");
        addXBtn.type = "button";
        addXBtn.className = "btn-add-interval";
        addXBtn.textContent = "+ x interval";
        addXBtn.addEventListener("click", () => {
            func.xRanges.push([lvl.xMin, lvl.xMax]);
            updateMathDetailsPanel();
            precalculateSimulation();
            board.update();
            triggerRedraw();
        });
        
        grid.appendChild(xContainer);
        grid.appendChild(addXBtn);
        
        // Y-Intervals list
        const yContainer = document.createElement("div");
        yContainer.className = "interval-list-container";
        
        func.yRanges.forEach((range, rIdx) => {
            const rangeRow = document.createElement("div");
            rangeRow.className = "interval-row";
            
            const group = document.createElement("div");
            group.className = "range-inputs-group";
            group.innerHTML = '<span>y: [</span>';
            
            const minInput = document.createElement("input");
            minInput.className = "range-input";
            minInput.type = "text";
            minInput.value = range[0].toString();
            minInput.addEventListener("change", () => {
                const parsed = parseFloat(minInput.value);
                if (!isNaN(parsed)) {
                    range[0] = parsed;
                    board.update();
                    precalculateSimulation();
                    triggerRedraw();
                }
            });
            
            const maxInput = document.createElement("input");
            maxInput.className = "range-input";
            maxInput.type = "text";
            maxInput.value = range[1].toString();
            maxInput.addEventListener("change", () => {
                const parsed = parseFloat(maxInput.value);
                if (!isNaN(parsed)) {
                    range[1] = parsed;
                    board.update();
                    precalculateSimulation();
                    triggerRedraw();
                }
            });
            
            const delIntervalBtn = document.createElement("button");
            delIntervalBtn.type = "button";
            delIntervalBtn.className = "btn-delete-interval";
            delIntervalBtn.textContent = "×";
            delIntervalBtn.title = "Delete y interval";
            delIntervalBtn.addEventListener("click", () => {
                func.yRanges.splice(rIdx, 1);
                updateMathDetailsPanel();
                precalculateSimulation();
                board.update();
                triggerRedraw();
            });
            
            group.appendChild(minInput);
            group.appendChild(document.createTextNode(", "));
            group.appendChild(maxInput);
            group.appendChild(document.createTextNode("]"));
            
            rangeRow.appendChild(group);
            rangeRow.appendChild(delIntervalBtn);
            yContainer.appendChild(rangeRow);
        });
        
        const addYBtn = document.createElement("button");
        addYBtn.type = "button";
        addYBtn.className = "btn-add-interval";
        addYBtn.textContent = "+ y interval";
        addYBtn.addEventListener("click", () => {
            func.yRanges.push([lvl.yMin, lvl.yMax]);
            updateMathDetailsPanel();
            precalculateSimulation();
            board.update();
            triggerRedraw();
        });
        
        grid.appendChild(yContainer);
        grid.appendChild(addYBtn);
        row.appendChild(grid);
        
        mathDetails.appendChild(row);
    });
    
    // 3. Gems/Rewards (Gold GeoGebra Rows)
    lvl.rewards.forEach((rwd) => {
        const row = document.createElement("div");
        row.className = "geogebra-row";
        
        const icon = document.createElement("div");
        icon.className = "geogebra-icon gem";
        
        const text = document.createElement("div");
        text.className = "geogebra-text math-render";
        text.textContent = `\\((${rwd.pos.x.toFixed(1)}, ${rwd.pos.y.toFixed(1)})\\)`;
        
        row.appendChild(icon);
        row.appendChild(text);
        mathDetails.appendChild(row);
    });
    
    // Trigger KaTeX typesetting using auto-render extension
    if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(mathDetails, {
            delimiters: [
                { left: "$$", right: "$$", display: true },
                { left: "\\(", right: "\\)", display: false }
            ],
            throwOnError: false
        });
    }
}

// Compile currently typed expression and add it persistently to playerFunctions
function addCurrentFunction() {
    if (gameState === "SIMULATING") return;
    
    const rawVal = equationInput.value.trim();
    if (rawVal.length === 0) return;
    
    const val = normalizeEquation(rawVal);
    
    const lvl = levels[currentLevelIndex];
    const isEditing = editingFuncIndex >= 0 && editingFuncIndex < playerFunctions.length;
    
    // 1. Enforce maxFunctions count constraint (disabled if set to -1, skip if editing existing)
    if (!isEditing && lvl.constraints && lvl.constraints.maxFunctions !== undefined && lvl.constraints.maxFunctions !== -1) {
        if (playerFunctions.length >= lvl.constraints.maxFunctions) {
            updateStatus(`Constraint Violation: Max functions allowed is ${lvl.constraints.maxFunctions}!`, "error");
            return;
        }
    }
    
    // 2. Enforce forbidden operators constraint
    try {
        const tokens = tokenize(val);
        if (lvl.constraints && lvl.constraints.forbiddenOperators) {
            const violated = tokens.filter(t => lvl.constraints.forbiddenOperators.includes(t.value));
            if (violated.length > 0) {
                const names = [...new Set(violated.map(t => t.value))].join(", ");
                updateStatus(`Constraint Violation: Operator(s) [${names}] are forbidden!`, "error");
                return;
            }
        }
    } catch (e) {
        updateStatus(`Syntax Error: ${e.message}`, "error");
        return;
    }
    
    try {
        const parsed = parseExpression(val);
        if (parsed) {
            const funcType = funcTypeSelect ? funcTypeSelect.value : "explicit";
            let displayExpression = parsed;
            
            if (funcType === "derivative") {
                const h = 0.0001;
                displayExpression = (x, yVal) => {
                    const y2 = parsed(x + h, yVal);
                    const y1 = parsed(x - h, yVal);
                    if (isNaN(y2) || isNaN(y1)) return (yVal === undefined) ? NaN : 999999;
                    return (y2 - y1) / (2 * h);
                };
            } else if (funcType === "integral") {
                displayExpression = (x, yVal) => {
                    const baseVal = parsed(0, yVal);
                    if (isNaN(baseVal) || baseVal === 999999) return (yVal === undefined) ? NaN : 999999;
                    const steps = Math.min(100, Math.ceil(Math.abs(x) / 0.1));
                    if (steps === 0) return 0;
                    const dx = x / steps;
                    let sum = 0;
                    let prevVal = baseVal;
                    for (let i = 1; i <= steps; i++) {
                        const t = i * dx;
                        const val = parsed(t, yVal);
                        if (isNaN(prevVal) || isNaN(val) || val === 999999) return (yVal === undefined) ? NaN : 999999;
                        sum += (prevVal + val) * 0.5 * dx;
                        prevVal = val;
                    }
                    return sum;
                };
            }
            
            const funcObj = {
                id: 'pfunc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                type: funcType,
                expressionString: val,
                expression: displayExpression,
                xRanges: [[lvl.xMin, lvl.xMax]],
                yRanges: [[lvl.yMin, lvl.yMax]],
                jxgElement: null
            };
            
            // Plot on board with reactive interval filters
            if (funcType === "explicit" || funcType === "derivative" || funcType === "integral") {
                funcObj.jxgElement = board.create('functiongraph', [
                    (x) => {
                        const inX = funcObj.xRanges.some(r => x >= r[0] && x <= r[1]);
                        if (!inX) return NaN;
                        const y = funcObj.expression(x);
                        const inY = funcObj.yRanges.some(r => y >= r[0] && y <= r[1]);
                        if (!inY) return NaN;
                        return y;
                    }
                ], {
                    strokeColor: '#2c72c0',
                    strokeWidth: 4,
                    highlight: false
                });
            } else {
                funcObj.jxgElement = board.create('implicitcurve', [
                    (x, y) => {
                        const inX = funcObj.xRanges.some(r => x >= r[0] && x <= r[1]);
                        if (!inX) return 1; // Return non-zero to hide outside interval
                        const inY = funcObj.yRanges.some(r => y >= r[0] && y <= r[1]);
                        if (!inY) return 1;
                        return funcObj.expression(x, y);
                    }
                ], {
                    strokeColor: '#2c72c0',
                    strokeWidth: 4,
                    highlight: false
                });
            }
            
            if (isEditing) {
                // Replace the existing function's board element and data in-place
                const old = playerFunctions[editingFuncIndex];
                if (old.jxgElement && board) {
                    try { board.removeObject(old.jxgElement); } catch(e) {}
                }
                // Preserve the existing x/y ranges from the old entry
                funcObj.xRanges = old.xRanges;
                funcObj.yRanges = old.yRanges;
                playerFunctions[editingFuncIndex] = funcObj;
                editingFuncIndex = -1;
            } else {
                playerFunctions.push(funcObj);
            }
            
            // Clear preview curve
            equationInput.value = "";
            updateEquationInputLatex();
            playerExpression = null;
            if (playerCurveElement) {
                board.removeObject(playerCurveElement);
                playerCurveElement = null;
            }
            
            // Refresh
            updateMathDetailsPanel();
            precalculateSimulation();
            triggerRedraw();
        }
    } catch (e) {
        console.error("Failed to parse and add expression:", e);
        updateStatus(`Syntax Error: ${e.message}`, "error");
    }
}

// Helper to find roots of an implicit function f(x,y)=0 at a specific x using zero-crossing search
function findImplicitRoots(func, x) {
    const roots = [];
    const step = 0.1;
    
    // We only scan within the user's defined yRanges for this function.
    func.yRanges.forEach(range => {
        const yStart = range[0];
        const yEnd = range[1];
        let prevY = yStart;
        let prevVal = func.expression(x, prevY);
        
        for (let y = yStart + step; y <= yEnd + step; y += step) {
            const currentY = Math.min(y, yEnd);
            const currentVal = func.expression(x, currentY);
            
            // Check for zero crossing
            if (prevVal * currentVal <= 0) {
                if (prevVal === 0) {
                    if (roots.length === 0 || Math.abs(roots[roots.length - 1] - prevY) > 0.01) {
                        roots.push(prevY);
                    }
                } else if (currentVal !== 0) {
                    // Linear interpolation for a better estimate of the root
                    const rootY = prevY - prevVal * ((currentY - prevY) / (currentVal - prevVal));
                    if (roots.length === 0 || Math.abs(roots[roots.length - 1] - rootY) > 0.01) {
                        roots.push(rootY);
                    }
                }
            }
            prevY = currentY;
            prevVal = currentVal;
            if (currentY === yEnd) break;
        }
        
        // Final check if currentVal exactly 0 at yEnd
        if (prevVal === 0) {
            if (roots.length === 0 || Math.abs(roots[roots.length - 1] - prevY) > 0.01) {
                roots.push(prevY);
            }
        }
    });
    return roots;
}

// Helper to evaluate the overall player path at coordinate x
function evaluateOverallPlayerPath(x) {
    // If no player functions have been locked in, use the active input preview
    // BUT: during simulation, only use committed playerFunctions (not the preview)
    if (playerFunctions.length === 0) {
        if (!playerExpression || gameState === "SIMULATING") return { status: "empty" };
        
        let displayExpression = playerExpression;
        const funcType = funcTypeSelect ? funcTypeSelect.value : "explicit";
        
        if (funcType === "derivative") {
            const h = 0.0001;
            displayExpression = (tVal) => {
                const y2 = playerExpression(tVal + h);
                const y1 = playerExpression(tVal - h);
                if (isNaN(y2) || isNaN(y1)) return NaN;
                return (y2 - y1) / (2 * h);
            };
        } else if (funcType === "integral") {
            displayExpression = (tVal) => {
                const baseVal = playerExpression(0);
                if (isNaN(baseVal)) return NaN;
                const steps = Math.min(100, Math.ceil(Math.abs(tVal) / 0.1));
                if (steps === 0) return 0;
                const dx = tVal / steps;
                let sum = 0;
                let prevVal = baseVal;
                for (let i = 1; i <= steps; i++) {
                    const t = i * dx;
                    const val = playerExpression(t);
                    if (isNaN(prevVal) || isNaN(val)) return NaN;
                    sum += (prevVal + val) * 0.5 * dx;
                    prevVal = val;
                }
                return sum;
            };
        }
        
        const y = displayExpression(x);
        if (isNaN(y) || !isFinite(y)) return { status: "undefined" };
        return { status: "ok", y: y, count: 1 };
    }
    
    const activeYs = [];
    playerFunctions.forEach((func, idx) => {
        // Check if x falls within at least one xRange
        const inX = func.xRanges.some(r => x >= r[0] && x <= r[1]);
        if (inX) {
            if (func.type === 'implicit') {
                const roots = findImplicitRoots(func, x);
                roots.forEach(y => activeYs.push({ y, index: idx }));
            } else {
                const y = func.expression(x);
                if (!isNaN(y) && isFinite(y)) {
                    // Check if y falls within at least one yRange
                    const inY = func.yRanges.some(r => y >= r[0] && y <= r[1]);
                    if (inY) {
                        activeYs.push({ y, index: idx });
                    }
                }
            }
        }
    });
    
    if (activeYs.length === 0) {
        return { status: "undefined" };
    }
    
    if (activeYs.length === 1) {
        return { status: "ok", y: activeYs[0].y, count: 1 };
    }
    
    // Check if there are overlapping functions with different Y values (vertical line test failure)
    let hasConflict = false;
    const firstY = activeYs[0].y;
    for (let i = 1; i < activeYs.length; i++) {
        if (Math.abs(activeYs[i].y - firstY) > 0.05) {
            hasConflict = true;
            break;
        }
    }
    
    if (hasConflict) {
        return { status: "conflict", y: firstY, count: activeYs.length };
    } else {
        return { status: "ok", y: firstY, count: activeYs.length };
    }
}

// Pre-calculate path collisions and collections
function precalculateSimulation() {
    const lvl = levels[currentLevelIndex];
    const dx = 0.04;
    const steps = Math.ceil((lvl.finishX - lvl.startX) / dx);
    
    collisionDetected = false;
    collisionX = 999;
    collisionY = 0;
    crashReason = ""; // Reset crash reason
    
    // Setup rewards copy
    activeRewards = lvl.rewards.map(rwd => ({
        ...rwd,
        collected: false,
        animScale: 1.0,
        animAlpha: 1.0,
        isCollectable: false
    }));
    
    if (playerFunctions.length === 0) return;
    
    let prevX = lvl.startX;
    let startEval = evaluateOverallPlayerPath(prevX);
    
    let arcLength = 0;
    let prevSlope = null;
    
    if (startEval.status === "undefined" || startEval.status === "empty") {
        collisionDetected = true;
        collisionX = lvl.startX;
        collisionY = 0;
        crashReason = (lvl.constraints && lvl.constraints.requireContinuous) ? "DISCONTINUITY" : "UNDEFINED";
    } else if (startEval.status === "conflict") {
        collisionDetected = true;
        collisionX = lvl.startX;
        collisionY = startEval.y;
        crashReason = "NOT_ONE_TO_ONE";
    } else {
        let prevY = startEval.y;
        
        // Check if starting coordinate is already out of bounds
        if (prevY > lvl.yMax || prevY < lvl.yMin) {
            collisionDetected = true;
            collisionX = lvl.startX;
            collisionY = prevY > lvl.yMax ? lvl.yMax : lvl.yMin;
            crashReason = "OUT_OF_BOUNDS";
        }
        
        // Enforce Start Y Level constraint (if not -1)
        if (!collisionDetected && lvl.constraints && lvl.constraints.truckStartYLevel !== undefined && lvl.constraints.truckStartYLevel !== -1) {
            if (Math.abs(prevY - lvl.constraints.truckStartYLevel) > 0.05) {
                collisionDetected = true;
                collisionX = lvl.startX;
                collisionY = prevY;
                crashReason = "START_Y_MISMATCH";
            }
        }
        
        if (!collisionDetected) {
            for (let i = 1; i <= steps; i++) {
                const x = lvl.startX + i * dx;
                const evalResult = evaluateOverallPlayerPath(x);
                
                // Undefined gap check
                if (evalResult.status === "undefined") {
                    collisionDetected = true;
                    collisionX = x;
                    collisionY = prevY;
                    crashReason = (lvl.constraints && lvl.constraints.requireContinuous) ? "DISCONTINUITY" : "UNDEFINED";
                    break;
                }
                
                // Conflict check (failed vertical line test)
                if (evalResult.status === "conflict") {
                    collisionDetected = true;
                    collisionX = x;
                    collisionY = evalResult.y;
                    crashReason = "NOT_ONE_TO_ONE";
                    break;
                }
                
                const y = evalResult.y;
                
                // Continuity check (sudden vertical jump exceeding 1.0)
                if (lvl.constraints && lvl.constraints.requireContinuous) {
                    if (Math.abs(y - prevY) > 1.0) {
                        collisionDetected = true;
                        collisionX = x;
                        collisionY = prevY;
                        crashReason = "DISCONTINUITY";
                        break;
                    }
                }
                
                // Smoothness check (derivative slope change > 0.3)
                const slope = (y - prevY) / dx;
                if (prevSlope !== null) {
                    const slopeChange = Math.abs(slope - prevSlope);
                    if (lvl.constraints && lvl.constraints.requireSmooth && slopeChange > 0.3) {
                        collisionDetected = true;
                        collisionX = x;
                        collisionY = y;
                        crashReason = "SHARP_CORNER";
                        break;
                    }
                }
                prevSlope = slope;
                
                // Arc length / Fuel limit check (disabled if set to -1)
                arcLength += Math.hypot(dx, y - prevY);
                if (lvl.constraints && lvl.constraints.maxArcLength && lvl.constraints.maxArcLength !== -1 && arcLength > lvl.constraints.maxArcLength) {
                    collisionDetected = true;
                    collisionX = x;
                    collisionY = y;
                    crashReason = "FUEL_LIMIT";
                    break;
                }
                
                // Viewport Y bounds out-of-bounds check
                if (y > lvl.yMax || y < lvl.yMin) {
                    collisionDetected = true;
                    const limitY = y > lvl.yMax ? lvl.yMax : lvl.yMin;
                    const dy_step = y - prevY;
                    const t = Math.abs(dy_step) > 0.001 ? Math.abs(limitY - prevY) / Math.abs(dy_step) : 0.5;
                    collisionX = prevX + t * dx;
                    collisionY = limitY;
                    crashReason = "OUT_OF_BOUNDS";
                    break;
                }
                
                // 1. Circle obstacles (strictly crossing the equation boundary)
                let hit = false;
                for (let j = 0; j < lvl.obstacles.length; j++) {
                    const obs = lvl.obstacles[j];
                    if (obs.type === "point") {
                        const valCurr = (x - obs.pos.x)**2 + (y - obs.pos.y)**2 - obs.radius**2;
                        const valPrev = (prevX - obs.pos.x)**2 + (prevY - obs.pos.y)**2 - obs.radius**2;
                        
                        if (valCurr * valPrev <= 0) {
                            collisionDetected = true;
                            const denom = Math.abs(valCurr) + Math.abs(valPrev);
                            const t = denom > 0.001 ? Math.abs(valPrev) / denom : 0.5;
                            collisionX = prevX + t * dx;
                            
                            const evalCollision = evaluateOverallPlayerPath(collisionX);
                            collisionY = evalCollision.status === "ok" ? evalCollision.y : y;
                            
                            crashReason = "OBSTACLE";
                            hit = true;
                            break;
                        }
                    }
                }
                if (hit) break;
                
                // 2. Curve obstacles (strictly actual crossings)
                for (let j = 0; j < lvl.obstacles.length; j++) {
                    const obs = lvl.obstacles[j];
                    if (obs.type === "function" && obs.expression) {
                        if (obs.xRange && (x < obs.xRange[0] || x > obs.xRange[1] || prevX < obs.xRange[0] || prevX > obs.xRange[1])) {
                            continue;
                        }
                        
                        const obsY = obs.expression(x);
                        if (!isNaN(obsY) && isFinite(obsY)) {
                            const prevObsY = obs.expression(prevX);
                            
                            if (obs.yRange && (obsY < obs.yRange[0] || obsY > obs.yRange[1] || prevObsY < obs.yRange[0] || prevObsY > obs.yRange[1])) {
                                continue;
                            }
                            
                            const signCurr = y - obsY;
                            const signPrev = prevY - prevObsY;
                            
                            if (signCurr * signPrev <= 0) {
                                collisionDetected = true;
                                const denom = Math.abs(signCurr) + Math.abs(signPrev);
                                const t = denom > 0.001 ? Math.abs(signPrev) / denom : 0.5;
                                collisionX = prevX + t * dx;
                                
                                const evalCollision = evaluateOverallPlayerPath(collisionX);
                                collisionY = evalCollision.status === "ok" ? evalCollision.y : y;
                                
                                crashReason = "OBSTACLE";
                                hit = true;
                                break;
                            }
                        }
                    }
                }
                if (hit) break;
                
                prevX = x;
                prevY = y;
            }
            
            // Check end Y level constraint if loop finished successfully
            if (!collisionDetected && lvl.constraints && lvl.constraints.truckEndYLevel !== undefined && lvl.constraints.truckEndYLevel !== -1) {
                const endEval = evaluateOverallPlayerPath(lvl.finishX);
                if (endEval.status === "ok" && Math.abs(endEval.y - lvl.constraints.truckEndYLevel) > 0.05) {
                    collisionDetected = true;
                    collisionX = lvl.finishX;
                    collisionY = endEval.y;
                    crashReason = "END_Y_MISMATCH";
                }
            }
        }
    }
    
    // 3. Rewards collections (check if curve passes exactly through the gem point)
    activeRewards.forEach((rwd) => {
        const evalResult = evaluateOverallPlayerPath(rwd.pos.x);
        if (evalResult.status === "ok") {
            const distY = Math.abs(evalResult.y - rwd.pos.y);
            if (distY <= 0.02) {
                rwd.isCollectable = true;
            }
        }
    });
}

function startSimulation() {
    if (gameState === "SIMULATING") return;
    
    // Only allow simulation if at least one function has been committed (not just a preview)
    if (playerFunctions.length === 0) {
        return;
    }
    
    // Hide modal if somehow open
    hideEndLevelModal();
    
    // Set higher opacity for the active driving simulation line
    curveOpacity = 1.0;
    gameState = "SIMULATING";
    currentX = levels[currentLevelIndex].startX;
    particles = [];
    
    playButton.disabled = true;
    startLoop();
}

function resetSimulation(clearFunctions = true) {
    gameState = "IDLE";
    currentX = levels[currentLevelIndex].startX;
    particles = [];
    curveOpacity = 0.3;
    editingFuncIndex = -1;
    
    if (clearFunctions) {
        // Clear all player functions from JSXGraph and array
        playerFunctions.forEach(fn => {
            if (fn.jxgElement && board) {
                try { board.removeObject(fn.jxgElement); } catch(e) {}
            }
        });
        playerFunctions = [];
        
        // Clear input box and refresh latex
        equationInput.value = "";
        if (typeof updateEquationInputLatex === "function") {
            updateEquationInputLatex();
        }
    }
    
    // Clear active preview curve
    playerExpression = null;
    if (playerCurveElement && board) {
        try { board.removeObject(playerCurveElement); } catch(e) {}
        playerCurveElement = null;
    }
    
    hideEndLevelModal();
    
    const lvl = levels[currentLevelIndex];
    activeRewards = lvl.rewards.map(rwd => ({
        ...rwd,
        collected: false,
        animScale: 1.0,
        animAlpha: 1.0,
        isCollectable: false
    }));
    
    playButton.disabled = false;
    
    updateMathDetailsPanel();
    precalculateSimulation();
    triggerRedraw();
}

function updateStatus(text, type) {
    // Status text element removed from layout
}

// Show the popup Modal at the end of a level
function showEndLevelModal(success, message) {
    endLevelModal.style.display = "flex";
    
    if (success) {
        modalTitle.textContent = "SUCCESS!";
        modalTitle.style.color = "var(--status-success)";
        modalMessage.textContent = message;
        
        // If there's a next level, set primary to "Next Level"
        if (currentLevelIndex < levels.length - 1) {
            modalPrimaryBtn.textContent = "Next Level";
        } else {
            modalPrimaryBtn.textContent = "Play Again";
        }
        
        modalSecondaryBtn.textContent = "Replay";
        modalSecondaryBtn.style.display = "block";
    } else {
        modalTitle.textContent = "CRASHED!";
        modalTitle.style.color = "var(--status-error)";
        modalMessage.textContent = message;
        
        modalPrimaryBtn.textContent = "Retry";
        modalSecondaryBtn.style.display = "none";
    }
}

function hideEndLevelModal() {
    endLevelModal.style.display = "none";
}

function showLevelInfoModal() {
    infoModal.style.display = "flex";
}

function hideLevelInfoModal() {
    infoModal.style.display = "none";
}

// Action handlers for the Modal Buttons
function handleModalPrimaryAction() {
    hideEndLevelModal();
    if (gameState === "SUCCESS") {
        if (currentLevelIndex < levels.length - 1) {
            loadLevel(currentLevelIndex + 1);
        } else {
            loadLevel(0); // Restart Level 1
        }
    } else {
        // Retry after crash: don't clear player functions
        resetSimulation(false);
    }
}

function handleModalSecondaryAction() {
    hideEndLevelModal();
    resetSimulation(false);
}

// Particle explosion builder
function spawnExplosion(sx, sy, color) {
    for (let i = 0; i < 24; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.0 + Math.random() * 4.0;
        particles.push({
            x: sx,
            y: sy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: 2 + Math.random() * 3,
            color: color,
            alpha: 1.0,
            decay: 0.02 + Math.random() * 0.03
        });
    }
    startLoop();
}

// Screen Dimension Scaling
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (board) {
        board.resizeContainer(canvas.width, canvas.height);
        board.fullUpdate();
    }
    triggerRedraw();
}

function triggerRedraw() {
    draw();
}

// Convert user mathematical coordinates to screen canvas pixels using standard JSXGraph API
function mathToScreen(mathX, mathY) {
    if (!board) return { x: 0, y: 0 };
    const coords = new JXG.Coords(JXG.COORDS_BY_USER, [mathX, mathY], board);
    return {
        x: coords.scrCoords[1],
        y: coords.scrCoords[2]
    };
}

// Graphics Draw Loop
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!board) return;
    
    const lvl = levels[currentLevelIndex];
    
    // 1. Draw rewards (gems) as filled diamonds on the overlay canvas
    activeRewards.forEach((rwd) => {
        if (rwd.animAlpha <= 0.01) return;
        
        const center = mathToScreen(rwd.pos.x, rwd.pos.y);
        
        // Calculate dynamic gem radius relative to JSXGraph zoom level
        const p0 = mathToScreen(0, 0);
        const p1 = mathToScreen(0.12, 0);
        const baseRPx = Math.max(6, Math.abs(p1.x - p0.x));
        const rPx = baseRPx * rwd.animScale;
        
        const halfW = rPx * 0.9;
        const halfH = rPx * 1.25;
        
        ctx.save();
        ctx.globalAlpha = rwd.animAlpha;
        
        // Draw diamond
        ctx.beginPath();
        ctx.moveTo(center.x, center.y - halfH);
        ctx.lineTo(center.x + halfW, center.y);
        ctx.lineTo(center.x, center.y + halfH);
        ctx.lineTo(center.x - halfW, center.y);
        ctx.closePath();
        
        // Solid gold/yellow fill
        ctx.fillStyle = "#e59c00";
        ctx.fill();
        
        // Reddish outline
        ctx.strokeStyle = "#c05800";
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.restore();
    });
    
    // 2. Draw Tractor Sprite
    const truckImg = truckImages[Math.floor(Date.now() / 80) % 5]; // cycle frames at 12 FPS
    const currentFrame = truckImg;
    
    if (currentFrame && currentFrame.complete && (gameState === "SIMULATING" || gameState === "CRASHED" || gameState === "SUCCESS" || gameState === "IDLE")) {
        let drawX = currentX;
        let drawY = 0;
        
        const pathEval = evaluateOverallPlayerPath(drawX);
        if (pathEval.status === "ok" || pathEval.status === "conflict") {
            drawY = pathEval.y;
        }
        
        const posCurr = mathToScreen(drawX, drawY);
        
        // Calculate tangent rotation angle
        let angle = 0;
        const nextX = drawX + 0.05;
        const nextEval = evaluateOverallPlayerPath(nextX);
        if (nextEval.status === "ok" || nextEval.status === "conflict") {
            const nextScr = mathToScreen(nextX, nextEval.y);
            angle = Math.atan2(nextScr.y - posCurr.y, nextScr.x - posCurr.x);
        }
        
        // Draw truck rotated
        ctx.save();
        ctx.translate(posCurr.x, posCurr.y);
        ctx.rotate(angle);
        
        const scaleFactor = targetTruckHeight / currentFrame.height;
        const markerY = markerYOffset * scaleFactor;
        const imgWidth = currentFrame.width * scaleFactor;
        const imgHeight = currentFrame.height * scaleFactor;
        
        ctx.translate(0, -markerY);
        ctx.drawImage(currentFrame, -imgWidth / 2, -imgHeight / 2, imgWidth, imgHeight);
        ctx.restore();
    }
    
    // 3. Draw particles
    particles.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;
        
        if (p.alpha <= 0.01) {
            particles.splice(idx, 1);
            return;
        }
        
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });
}

// Particle Updates & Simulation frame ticker
function update(delta) {
    if (gameState !== "SIMULATING") return;
    
    const lvl = levels[currentLevelIndex];
    
    // Advance X coordinate
    currentX += simulationSpeed * delta;
    
    // Crash check
    if (collisionDetected && currentX >= collisionX) {
        currentX = collisionX;
        gameState = "CRASHED";
        
        const scrCrash = mathToScreen(collisionX, collisionY);
        spawnExplosion(scrCrash.x, scrCrash.y, "#a83232");
        
        let msg = "";
        if (crashReason === "OUT_OF_BOUNDS") {
            msg = `Out of Bounds! Went outside the grid limits at (${collisionX.toFixed(2)}, ${collisionY.toFixed(2)})!`;
        } else if (crashReason === "UNDEFINED") {
            msg = `Math Error: Function is undefined at x = ${collisionX.toFixed(2)}!`;
        } else if (crashReason === "DISCONTINUITY") {
            msg = `Discontinuity Error: Segments do not connect at x = ${collisionX.toFixed(2)}!`;
        } else if (crashReason === "SHARP_CORNER") {
            msg = `Corner Crash: Curve transition is too sharp at x = ${collisionX.toFixed(2)}!`;
        } else if (crashReason === "FUEL_LIMIT") {
            msg = `Fuel Exhausted: Path is too long for the fuel tank at (${collisionX.toFixed(2)}, ${collisionY.toFixed(2)})!`;
        } else if (crashReason === "START_Y_MISMATCH") {
            msg = `Start Error: Path must start at y = ${lvl.constraints.truckStartYLevel.toFixed(1)}! Currently starts at y = ${collisionY.toFixed(2)}.`;
        } else if (crashReason === "END_Y_MISMATCH") {
            msg = `Finish Error: Path must end at y = ${lvl.constraints.truckEndYLevel.toFixed(1)}! Currently ends at y = ${collisionY.toFixed(2)}.`;
        } else if (crashReason === "NOT_ONE_TO_ONE") {
            msg = `Conflict Error: Path is not single-valued (fails vertical line test) at x = ${collisionX.toFixed(2)}!`;
        } else {
            msg = `Boom! Crashed into obstacle at (${collisionX.toFixed(2)}, ${collisionY.toFixed(2)})!`;
        }
        updateStatus(msg, "error");
        
        // Show crash pop-up modal after a tiny delay
        setTimeout(() => {
            if (gameState === "CRASHED") showEndLevelModal(false, msg);
        }, 1200);
    }
    // Success check
    else if (currentX >= lvl.finishX) {
        currentX = lvl.finishX;
        gameState = "SUCCESS";
        
        const finishEval = evaluateOverallPlayerPath(lvl.finishX);
        const finishY = (finishEval.status === "ok" || finishEval.status === "conflict") ? finishEval.y : 0;
        const scrFinish = mathToScreen(lvl.finishX, finishY);
        spawnExplosion(scrFinish.x, scrFinish.y, "#2c6a4f");
        
        const coinsCollected = activeRewards.filter(rwd => rwd.collected).length;
        const msg = `Victory! Collected ${coinsCollected}/${activeRewards.length} gems.`;
        updateStatus(msg, "success");
        
        // Show success pop-up modal after a tiny delay
        setTimeout(() => {
            if (gameState === "SUCCESS") showEndLevelModal(true, msg);
        }, 1200);
    }
    
    // Animate collected rewards
    activeRewards.forEach((rwd) => {
        if (rwd.isCollectable && !rwd.collected && currentX >= rwd.pos.x) {
            rwd.collected = true;
            const scrGem = mathToScreen(rwd.pos.x, rwd.pos.y);
            spawnExplosion(scrGem.x, scrGem.y, "#e59c00");
        }
        
        if (rwd.collected) {
            rwd.animScale = Math.max(0, rwd.animScale - 6 * delta);
            rwd.animAlpha = Math.max(0, rwd.animAlpha - 6 * delta);
        }
    });
}

// Main Game loop
let lastTime = 0;
let isLoopRunning = false;

function startLoop() {
    if (isLoopRunning) return;
    isLoopRunning = true;
    lastTime = 0;
    requestAnimationFrame(loop);
}

function loop(timestamp) {
    if (!isLoopRunning) return;
    
    if (!lastTime) lastTime = timestamp;
    const delta = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    
    const clampedDelta = Math.min(delta, 0.1);
    
    update(clampedDelta);
    draw();
    
    requestAnimationFrame(loop);
}

// -------------------------------------------------------------
// Desmos-Style Virtual Keyboard Implementation
// -------------------------------------------------------------

const keyboardToggleBtn = document.getElementById("keyboard-toggle-btn");
const mathKeyboard = document.getElementById("math-keyboard");
const bottomBar = document.getElementById("bottom-bar");
const kbLeftSection = document.getElementById("kb-left-section");
const kbBackspace = document.getElementById("kb-backspace");
const kbSubmit = document.getElementById("kb-submit");
const kbNavLeft = document.getElementById("kb-nav-left");
const kbNavRight = document.getElementById("kb-nav-right");
const kbToggleConstants = document.getElementById("kb-toggle-constants");

let kbOpen = false;

// Insert text at cursor position in equationInput
function insertTextAtCursor(input, text) {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const val = input.value;
    input.value = val.substring(0, start) + text + val.substring(end);
    input.selectionStart = input.selectionEnd = start + text.length;
    input.focus();
    handleEquationInput();
}

// Perform cursor navigation
function moveCursor(input, direction) {
    const pos = input.selectionStart;
    if (direction === 'left') {
        input.selectionStart = input.selectionEnd = Math.max(0, pos - 1);
    } else {
        input.selectionStart = input.selectionEnd = Math.min(input.value.length, pos + 1);
    }
    input.focus();
}

// Perform backspace delete at cursor
function performBackspace(input) {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const val = input.value;
    if (start === end) {
        if (start > 0) {
            input.value = val.substring(0, start - 1) + val.substring(end);
            input.selectionStart = input.selectionEnd = start - 1;
        }
    } else {
        input.value = val.substring(0, start) + val.substring(end);
        input.selectionStart = input.selectionEnd = start;
    }
    input.focus();
    handleEquationInput();
}

// Keyboard left block configurations
const layouts = {
    abc: [
        { label: "<i>x</i>", val: "x" },
        { label: "<i>y</i>", val: "y" },
        { label: "a²", val: "^2" },
        { label: "aᵇ", val: "^" },
        { label: "(", val: "(" },
        { label: ")", val: ")" },
        { label: "&lt;", val: "<" },
        { label: "&gt;", val: ">" },
        { label: "|a|", val: "abs(" },
        { label: ",", val: "," },
        { label: "&le;", val: "<=" },
        { label: "&ge;", val: ">=" },
        { label: "func", action: "toggle-func" },
        { label: "<i>e</i>", val: "e" },
        { label: "√", val: "sqrt(" },
        { label: "π", val: "pi" }
    ],
    func: [
        { label: "sin", val: "sin(" },
        { label: "cos", val: "cos(" },
        { label: "tan", val: "tan(" },
        { label: "aᵇ", val: "^" },
        { label: "|a|", val: "abs(" },
        { label: "√", val: "sqrt(" },
        { label: "log", val: "log(" },
        { label: "ln", val: "ln(" },
        { label: "(", val: "(" },
        { label: ")", val: ")" },
        { label: "&lt;", val: "<" },
        { label: "&gt;", val: ">" },
        { label: "abc", action: "toggle-abc" },
        { label: "<i>e</i>", val: "e" },
        { label: "π", val: "pi" },
        { label: ",", val: "," }
    ],
    consts: [
        { label: "π", val: "pi" },
        { label: "<i>e</i>", val: "e" },
        { label: "τ (tau)", val: "tau" },
        { label: "φ (phi)", val: "phi" },
        { label: "(", val: "(" },
        { label: ")", val: ")" },
        { label: "&lt;", val: "<" },
        { label: "&gt;", val: ">" },
        { label: "|a|", val: "abs(" },
        { label: ",", val: "," },
        { label: "&le;", val: "<=" },
        { label: "&ge;", val: ">=" },
        { label: "abc", action: "toggle-abc" },
        { label: "<i>x</i>", val: "x" },
        { label: "<i>y</i>", val: "y" },
        { label: "aᵇ", val: "^" }
    ]
};

function updateKeyboardDisabledStates() {
    const lvl = levels[currentLevelIndex];
    if (!lvl) return;
    const forbidden = (lvl.constraints && lvl.constraints.forbiddenOperators) ? lvl.constraints.forbiddenOperators : [];
    
    document.querySelectorAll(".kb-section-mid .kb-btn").forEach(btn => {
        const val = btn.dataset.val;
        const cleanVal = val ? val.replace("(", "") : "";
        if (cleanVal && forbidden.includes(cleanVal)) {
            btn.disabled = true;
        } else {
            btn.disabled = false;
        }
    });
}

function renderKeyboardLeft(mode) {
    kbLeftSection.innerHTML = "";
    const items = layouts[mode];
    const lvl = levels[currentLevelIndex];
    const forbidden = (lvl && lvl.constraints && lvl.constraints.forbiddenOperators) ? lvl.constraints.forbiddenOperators : [];
    
    items.forEach(item => {
        const btn = document.createElement("button");
        btn.type = "button";
        if (item.action) {
            btn.className = "kb-btn btn-toggle";
            btn.innerHTML = item.label;
            if (item.action === "toggle-func") {
                btn.addEventListener("click", () => renderKeyboardLeft("func"));
            } else if (item.action === "toggle-abc") {
                btn.addEventListener("click", () => renderKeyboardLeft("abc"));
            }
        } else {
            btn.className = "kb-btn btn-math";
            btn.innerHTML = item.label;
            btn.dataset.val = item.val;
            
            const cleanVal = item.val ? item.val.replace("(", "") : "";
            if (cleanVal && forbidden.includes(cleanVal)) {
                btn.disabled = true;
            }
            
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                insertTextAtCursor(equationInput, item.val);
            });
        }
        kbLeftSection.appendChild(btn);
    });
}

// Set up event listeners for keyboard buttons
function initKeyboardBindings() {
    // Bind numerical and operator keys
    document.querySelectorAll(".kb-section-mid .kb-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            insertTextAtCursor(equationInput, btn.dataset.val);
        });
    });

    // Toggle constants layout
    kbToggleConstants.addEventListener("click", (e) => {
        e.preventDefault();
        const mode = kbToggleConstants.dataset.mode;
        if (mode === "consts") {
            renderKeyboardLeft("consts");
            kbToggleConstants.textContent = "vars";
            kbToggleConstants.dataset.mode = "vars";
        } else {
            renderKeyboardLeft("abc");
            kbToggleConstants.textContent = "consts";
            kbToggleConstants.dataset.mode = "consts";
        }
    });

    // Navigation and delete bindings
    kbNavLeft.addEventListener("click", (e) => {
        e.preventDefault();
        moveCursor(equationInput, "left");
    });
    kbNavRight.addEventListener("click", (e) => {
        e.preventDefault();
        moveCursor(equationInput, "right");
    });
    kbBackspace.addEventListener("click", (e) => {
        e.preventDefault();
        performBackspace(equationInput);
    });
    kbSubmit.addEventListener("click", (e) => {
        e.preventDefault();
        startSimulation();
    });

    // Toggle slide up panel
    keyboardToggleBtn.addEventListener("click", () => {
        kbOpen = !kbOpen;
        mathKeyboard.classList.toggle("open", kbOpen);
        bottomBar.classList.toggle("kb-open", kbOpen);
        
        // Wait for slide up transition
        setTimeout(() => {
            resizeCanvas();
        }, 300);
    });

    // Initial render
    renderKeyboardLeft("abc");
}

// Initialize Web App by fetching levels dynamically
async function initGame() {
    try {
        const response = await fetch("levels.json?v=" + Date.now());
        levels = await response.json();
        
        resizeCanvas();
        loadLevel(0);
        initKeyboardBindings();
        startLoop();
    } catch (err) {
        console.error("Failed to load levels.json:", err);
    }
}

initGame();
