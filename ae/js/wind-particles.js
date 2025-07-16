class WindParticleSystem {
    constructor(scene, maxParticles = 5000) {
        this.scene = scene;
        this.maxParticles = maxParticles;
        this.particles = [];
        this.engine = scene.getEngine();
        this.currentBatch = 0;
        this.updateScheduled = false;
        
        this.createParticleSystem();
        this.initializeParticles();
    }
    
    createParticleSystem() {
        // Create a simple plane geometry for each particle
        this.particleGeometry = BABYLON.PlaneBuilder.CreatePlane("particle", { width: 0.05, height: 0.05 }, this.scene);
        this.particleGeometry.material = new BABYLON.StandardMaterial("particleMat", this.scene);
        this.particleGeometry.material.emissiveColor = new BABYLON.Color3(1.0, 1.0, 1.0);
        this.particleGeometry.material.alpha = 0.9;
        this.particleGeometry.material.useAlphaFromDiffuseTexture = true;
        this.particleGeometry.material.backFaceCulling = false; // Make visible from both sides
        
        // Use the material from the geometry
        this.particleMaterial = this.particleGeometry.material;
        
        // Create instanced mesh for maximum performance
        this.particleMesh = new BABYLON.InstancedMesh("particle", this.particleGeometry, this.scene);
        // Set material on the source mesh, not the instanced mesh
        this.particleGeometry.material = this.particleMaterial;
        
        // Create instances
        this.instances = [];
        for (let i = 0; i < this.maxParticles; i++) {
            const instance = this.particleMesh.createInstance("particle_" + i);
            this.instances.push(instance);
        }
    }
    
    initializeParticles() {
        for (let i = 0; i < this.maxParticles; i++) {
            this.particles.push({
                position: new BABYLON.Vector3(
                    (Math.random() - 0.5) * 60, // Much wider area
                    Math.random() * 15 + 2, // Stay above ground (y = -2) with some variation
                    (Math.random() - 0.5) * 40 // Deeper area
                ),
                velocity: new BABYLON.Vector3(
                    (Math.random() - 0.5) * 0.08,
                    (Math.random() - 0.5) * 0.04,
                    (Math.random() - 0.5) * 0.08
                ),
                life: Math.random(),
                maxLife: 1.0,
                size: Math.random() * 1.0 + 1.0,
                windInfluence: Math.random() * 0.5 + 0.5
            });
        }
    }
    
    updateWindField(time) {
        // Create wind field with multiple layers and turbulence
        const windStrength = 0.12;
        const turbulence = 0.04;
        
        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];
            
            // More convincing wind patterns with height-based variation
            const heightFactor = Math.max(0.5, (particle.position.y - 2) / 15); // Wind stronger at higher altitudes
            const windDirection = Math.sin(time * 0.2) * 0.3; // Wind direction changes over time
            
            // Create flowing wind patterns across the larger area
            const flowX = Math.sin(particle.position.x * 0.05 + time * 0.1) * 0.02; // Gentle flow variation
            const flowZ = Math.cos(particle.position.z * 0.03 + time * 0.15) * 0.01; // Cross-flow
            
            // Base wind direction with more realistic patterns
            const baseWind = new BABYLON.Vector3(
                (windStrength + windDirection + flowX) * particle.windInfluence * heightFactor,
                Math.sin(time * 0.5 + particle.position.x * 0.05) * turbulence * 0.3, // Reduced vertical movement
                (Math.cos(time * 0.3 + particle.position.z * 0.05) + flowZ) * turbulence
            );
            
            // Add realistic turbulence patterns
            const turbulenceX = Math.sin(time * 0.7 + particle.position.y * 0.2) * turbulence;
            const turbulenceY = Math.cos(time * 0.9 + particle.position.x * 0.15) * turbulence * 0.3; // Less vertical turbulence
            const turbulenceZ = Math.sin(time * 1.1 + particle.position.z * 0.25) * turbulence;
            
            // Add gust effects
            const gustStrength = Math.sin(time * 0.1 + particle.position.x * 0.05) * 0.02;
            const gustWind = new BABYLON.Vector3(gustStrength, 0, 0);
            
            particle.velocity.addInPlace(baseWind);
            particle.velocity.addInPlace(new BABYLON.Vector3(turbulenceX, turbulenceY, turbulenceZ));
            particle.velocity.addInPlace(gustWind);
            
            // Dampen velocity to prevent runaway (less dampening for faster movement)
            particle.velocity.scaleInPlace(0.99);
        }
    }
    
    updateParticles(deltaTime) {
        const time = Date.now() * 0.001;
        
        // Update wind field
        this.updateWindField(time);
        
        // Update all particles efficiently
        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];
            const instance = this.instances[i];
            
            // Update position
            particle.position.addInPlace(particle.velocity);
            
            // Wrap around boundaries (optimized) - keep Y above ground
            particle.position.x = ((particle.position.x + 30) % 60) - 30;
            particle.position.y = Math.max(2, ((particle.position.y + 10) % 20) - 10); // Never go below ground
            particle.position.z = ((particle.position.z + 20) % 40) - 20;
            
            // Update life
            particle.life += deltaTime * 0.1;
            if (particle.life > particle.maxLife) {
                particle.life = 0;
                // Reset particle to random position above ground
                particle.position.set(
                    (Math.random() - 0.5) * 60, // Much wider area
                    Math.random() * 15 + 2, // Stay above ground
                    (Math.random() - 0.5) * 40 // Deeper area
                );
            }
            
            // Update instance
            instance.position = particle.position;
            instance.scaling.setAll(particle.size * (0.5 + particle.life * 0.5));
            
            // Fade based on life
            const alpha = Math.sin(particle.life * Math.PI) * 0.9;
            instance.material.alpha = alpha;
        }
    }
    
    dispose() {
        if (this.particleGeometry) {
            this.particleGeometry.dispose();
        }
        if (this.particleMaterial) {
            this.particleMaterial.dispose();
        }
        if (this.particleMesh) {
            this.particleMesh.dispose();
        }
        this.instances.forEach(instance => instance.dispose());
    }
}

// Alternative: Ultra-high performance using compute shaders (if supported)
class ComputeWindParticles {
    constructor(scene, maxParticles = 50000) {
        this.scene = scene;
        this.maxParticles = maxParticles;
        this.engine = scene.getEngine();
        
        if (this.engine.webGLVersion >= 2) {
            this.createComputeParticleSystem();
        } else {
            console.log("WebGL 2 not supported, falling back to standard particles");
            this.windSystem = new WindParticleSystem(scene, maxParticles);
        }
    }
    
    createComputeParticleSystem() {
        // For now, fall back to standard particles since compute shaders need more setup
        console.log("Compute shaders not fully implemented, using standard particles");
        this.windSystem = new WindParticleSystem(this.scene, 50000);
        return;
        
        // Create particle buffers
        this.createParticleBuffers();
        this.createRenderSystem();
    }
    
    createParticleBuffers() {
        // Simplified for now - just use standard particles
    }
    
    createRenderSystem() {
        // Simplified for now - just use standard particles
    }
    
    updateParticles(deltaTime) {
        if (this.windSystem) {
            this.windSystem.updateParticles(deltaTime);
            return;
        }
        
        // For now, just use the standard particle system
        console.log("Using standard particle system");
    }
    
    dispose() {
        if (this.windSystem) {
            this.windSystem.dispose();
        } else {
            // Clean up compute resources
            const gl = this.engine._gl;
            gl.deleteBuffer(this.particleBuffer);
            gl.deleteBuffer(this.velocityBuffer);
            gl.deleteProgram(this.computeProgram);
            
            this.particleGeometry.dispose();
            this.particleMaterial.dispose();
            this.particleMesh.dispose();
            this.instances.forEach(instance => instance.dispose());
        }
    }
} 