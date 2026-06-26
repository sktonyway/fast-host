import express from 'express';
import Docker from 'dockerode';

const docker = new Docker();

function pullImagePromisified(img, tag) {
    return new Promise((res, rej) => {
        docker.pull(`${img}`, { tag }, (err) => {
            if (err) {
                rej(err);
            } else return res(true);
        });
    });
}

const managementApp = express();


managementApp.use(express.json());


const MANAGEMENT_API_PORT = process.env.MANAGEMENT_API_PORT ?? 8080;
const REVERSE_PROXY_HOST = process.env.REVERSE_PROXY_HOST ?? 'localhost';

managementApp.get('/health', (req, res) => {
    res.send({ message: "Server is healthy" })
})

managementApp.post('/docker', async (req, res) => {
    try {
        const { image, tag } = req.body;

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
            console.log(`Pulling image: ${image}:${tag}`);
            await pullImagePromisified(image, tag);
            console.log(`Successfully pulled image: ${image}:${tag}`);
        }

        console.log(`Creating container from image: ${image}:${tag}`);
        const container = await docker.createContainer({
            Image: `${image}:${tag}`,
            Cmd: ['/bin/bash', '-c', 'sleep infinity'],
            HostConfig: {
                AutoRemove: true,
            }
        });

        console.log(`Container created with ID: ${container.id}`);
        console.log(`Starting container: ${container.id}`);
        await container.start();
        console.log(`Container started successfully`);

        const inspect = await container.inspect();
        console.log(`Container inspection completed. State: ${inspect.State.Running}`);

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
    console.log('Started to listen.')
})