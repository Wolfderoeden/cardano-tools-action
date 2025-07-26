import { readdirSync, statSync, rmdirSync, mkdirSync, writeFileSync } from 'fs';
import { URL } from 'url';
import * as path from 'path';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);

// Retry mechanism for network requests
const fetchWithRetry = async (url, options = {}, maxRetries = 3, delay = 1000) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'User-Agent': 'cardano-tools-action/0.0.1 (+https://github.com/Qafana/cardano-tools-action)',
                    ...options.headers
                }
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response;
        } catch (error) {
            console.log(`Attempt ${attempt} failed:`, error.message);
            
            if (attempt === maxRetries) {
                throw error;
            }
            
            // Exponential backoff: wait longer between each retry
            const waitTime = delay * Math.pow(2, attempt - 1);
            console.log(`Retrying in ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
};

const BINS_BASE_URL = 'https://github.com/cardano-foundation/cardano-wallet';

const get_latest_release_tag = async () => {
    const response = await fetchWithRetry(`${BINS_BASE_URL}/releases/latest`, { 
        method: 'GET',
        headers: { 
            'Accept': 'application/json'
        }
    });
    const data = await response.json();
    return data.tag_name;
};

const getPlatformReleaseUrl = async () => {
    const platform = process.platform;
    const tag = await get_latest_release_tag();
    let file_name = '';
    if (platform === 'linux') {
        file_name = `cardano-wallet-${tag}-linux64.tar.gz`;
    }
    else if (platform === 'darwin') {
        file_name = `cardano-wallet-${tag}-macos-intel.tar.gz`;
    }
    else if (platform === 'win32') {
        file_name = `cardano-wallet-${tag}-win64.zip`;
    }
    else {
        throw new Error(`Platform ${platform} not supported`);
    }
    return `${BINS_BASE_URL}/releases/download/${tag}/${file_name}`;
};
export const downloadLatestRelease = async () => {
    const url = await getPlatformReleaseUrl();
    const urlObj = new URL(url);
    const file_name = urlObj.pathname.split('/').pop();
    if (!file_name) {
        throw new Error('Unable to determine the file name from the URL');
    }
    const dir = './bins';
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, file_name);
    
    // Use curl for more reliable downloads in CI/CD environments
    try {
        await exec(`curl -L -f --retry 5 --retry-delay 5 --connect-timeout 10 -o "${filePath}" "${url}"`);
    } catch (error) {
        console.error(`Error downloading file with curl: ${error}`);
        throw error;
    }
};
export const unpackLatestRelease = async () => {
    const url = await getPlatformReleaseUrl();
    const urlObj = new URL(url);
    const file_name = urlObj.pathname.split('/').pop();
    if (!file_name) {
        throw new Error('Unable to determine the file name from the URL');
    }
    const dir = './bins';
    const filePath = path.join(dir, file_name);
    try {
        if (['linux', 'darwin', 'win32'].includes(process.platform)) {
            await exec(`tar -xf "${filePath}" -C "${dir}"`);
            
            // Assuming the tar archive contains a single top-level directory
            const files = readdirSync(dir);
            const extractedDir = files.find(file => statSync(path.join(dir, file)).isDirectory());

            if (extractedDir) {
                await exec(`mv "${path.join(dir, extractedDir)}"/* "${dir}"`);
                rmdirSync(path.join(dir, extractedDir));
            }
        } else {
            throw new Error(`Platform ${process.platform} not supported`);
        }
    } catch (error) {
        console.error(`Error occurred while unpacking: ${error}`);
        throw error;
    }
};

export const moveToRunnerBin = async () => {
    const path = "/bin";
    console.log(`GITHUB_WORKSPACE: ${path}`);
    try {
        await exec(`sudo mv ./bins/* ${path}`);
    }
    catch (error) {
        console.error('Error occurred:', error);
        throw error;
    }
}