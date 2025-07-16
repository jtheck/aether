class FPSMeter {
    constructor(scene) {
        this.scene = scene;
        this.engine = scene.getEngine();
        this.fps = 0;
        this.frameCount = 0;
        this.lastTime = Date.now();
        
        this.createFPSDisplay();
        this.startMonitoring();
    }
    
    createFPSDisplay() {
        // Create a simple div for FPS display
        this.fpsDiv = document.createElement('div');
        this.fpsDiv.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.7);
            color: #00ff00;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            padding: 5px 10px;
            border-radius: 3px;
            z-index: 1000;
            pointer-events: none;
            user-select: none;
        `;
        this.fpsDiv.textContent = 'FPS: 60';
        document.body.appendChild(this.fpsDiv);
    }
    
    startMonitoring() {
        // Monitor FPS using the engine's render loop
        this.scene.onBeforeRenderObservable.add(() => {
            this.frameCount++;
            const currentTime = Date.now();
            
            // Update FPS every second
            if (currentTime - this.lastTime >= 1000) {
                this.fps = this.frameCount;
                this.frameCount = 0;
                this.lastTime = currentTime;
                
                // Update display with color coding
                let color = '#00ff00'; // Green for good FPS
                if (this.fps < 30) {
                    color = '#ff0000'; // Red for low FPS
                } else if (this.fps < 50) {
                    color = '#ffff00'; // Yellow for medium FPS
                }
                
                this.fpsDiv.style.color = color;
                this.fpsDiv.textContent = `FPS: ${this.fps}`;
            }
        });
    }
    
    dispose() {
        if (this.fpsDiv && this.fpsDiv.parentNode) {
            this.fpsDiv.parentNode.removeChild(this.fpsDiv);
        }
    }
} 