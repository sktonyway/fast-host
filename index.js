import express from 'express';
import Docker from 'dockerode';
import httpProxy from 'http-proxy'
import path from 'node:path'
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const docker = new Docker();

function pullImagePromisified(img, tag) {
    return new Promise((res, rej) => {
        docker.pull(`${img}:${tag}`, {}, (err, stream) => {
            if (err) {
                return rej(err);
            }

            docker.modem.followProgress(
                stream,
                (doneErr, output) => {
                    if (doneErr){
                        return rej(doneErr);
                    }
                    return res(output);
                },
                (event) => {
                    if (event.status){
                        console.log(`[pull ${img}:${tag}] ${event.status} ${event.progress ? `${event.progress}` : ''}`)
                    }
                }
            )
        });
    });
}

const managementApp = express();
const proxyApp = express();

const proxy = httpProxy.createProxy();

managementApp.use(express.json());
managementApp.use(express.static(path.join(__dirname, 'public')));

// Debug middleware
managementApp.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
});

// Serve index.html for root and unmatched routes
managementApp.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'index.html');
    console.log(`Sending file: ${filePath}`);
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('Error sending file:', err);
            res.status(500).send('Error loading page');
        }
    });
});


const MANAGEMENT_API_PORT = process.env.MANAGEMENT_API_PORT ?? 8080;
const REVERSE_PROXY_HOST = process.env.REVERSE_PROXY_HOST ?? 'localhost';

managementApp.get('/health', (req, res) => {
    res.send({ message: "Server is healthy" })
})

managementApp.post('/docker', async (req, res) => {
    try {
        const { image, tag } = req.body;
        console.log(image, tag)

        if (!image || !tag) {
            return res.status(400).json({ status: 'error', message: 'image and tag are required' });
        }

        const systemImages = await docker.listImages();
        let isExistingImage = false;

        for (const systemImage of systemImages) {
            const repoTags = systemImage.RepoTags || [];
            for (const systemTag of repoTags) {
                if (systemTag === `${image}:${tag}`) {
                    isExistingImage = true;
                    break;
                }
                if (isExistingImage) break;
            }
        }

        if (!isExistingImage) {
            await pullImagePromisified(image, tag);
        }

        const container = await docker.createContainer({
            Image: `${image}:${tag}`,
            // Cmd: ['/bin/bash', '-c', 'sleep infinity'],
            HostConfig: {
                AutoRemove: true,
            }
        });

        const network = docker.getNetwork('deploy-engine-network');

        await container.start();

        const inspect = await container.inspect();

        await network.connect({
            Container: inspect.Id,
        })

        return res.json({
            status: 'success',
            data: {
                containerId: container.id,
                containerName: inspect.Name,
                state: inspect.State,
                domain: `${inspect.Name}.${REVERSE_PROXY_HOST}`,
            }
        })
    } catch (err) {
        console.error('Error:', err.message);
        console.error('Stack:', err.stack);
        return res.status(500).json({
            status: 'error',
            message: err.message,
            stack: err.stack
        });
    }
});


managementApp.listen(MANAGEMENT_API_PORT, () => {
    console.log(`\n🐳 Dockploy started on http://localhost:${MANAGEMENT_API_PORT}`);
    console.log(`📁 Static files: ${path.join(__dirname, 'public')}\n`);
})

// Reverse proxy server

proxyApp.use((req,res)=>{
    const containerName = req.hostname.split('.')[0];
    return proxy.web(req, res, {
        target: `http://${containerName}:80`
    })
})

proxyApp.listen(80, ()=>{
    console.log('reverse proxy is running at port 80')
})