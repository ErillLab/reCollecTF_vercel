import { VercelRequest, VercelResponse } from '@vercel/node'; 
import { verify } from 'jsonwebtoken';
import axios from 'axios';
import { parse } from 'cookie';

const JWT_SECRET = process.env.JWT_SECRET!;
const BOT_TOKEN = process.env.BOT_TOKEN!;
const REPO_OWNER = 'ErillLab';
const REPO_NAME = 'reCollecTF';
const WORKFLOW_FILE_NAME = 'update-db.yml';

export default async function handler(req: VercelRequest, res: VercelResponse) {


    //Debug
    if (req.method === "GET") {
        return res.status(200).json({ whoami: "SEND-FORM MIGUEL" });
    }

    //0 - Allow CORS and verify POST
    const origin = "https://erilllab.github.io" //change in dev

    res.setHeader("Access-Control-Allow-Origin", origin); // to be changed in prod
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(200).end(); // CORS preflight
    }


    console.log("Calling send-form API");


    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Only POST allowed' });
    }

    //1 - Verify JWT token from cookies
    console.log("Cookie: ", req.headers.cookie);

    const cookies = parse(req.headers.cookie || '');
    const token = cookies['session_token'];
    console.log("Session token: ", token);
    if (!token) return res.status(401).json({ error: 'No session token' });

    let payload;
    try {
        payload = verify(token, JWT_SECRET) as any;
    } catch {
        return res.status(401).json({ error: 'Invalid session' });
    }

    //2 - Get SQL query

    const { inputs } = req.body;

    console.log("Inputs: ", inputs);

    // NEW: write SQL to a file in the repo and dispatch workflow with sql_path (avoid huge workflow_dispatch inputs)
    const sqlString = String(inputs?.queries || '');
    if (!sqlString.trim()) {
        return res.status(400).json({ error: 'Missing inputs.queries (SQL string)' });
    }

    // Put SQL in a committed file so workflow can read it via sql_path
    const safeTs = new Date().toISOString().replace(/[:.]/g, '-');
    const sqlPath = `pending-sql/${safeTs}.sql`;
    const sqlB64 = Buffer.from(sqlString, 'utf8').toString('base64');


    //3 - Dispatch GitHub workflow via GitHub API

    try {

        // 3a) Create SQL file in repo (GitHub Contents API)
        await axios.put(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(sqlPath)}`,
            {
                message: `Add SQL for workflow: ${sqlPath}`,
                content: sqlB64,
                branch: 'main',
            },
            {
                headers: {
                    Authorization: `Bearer ${BOT_TOKEN}`,
                    Accept: 'application/vnd.github+json',
                },
            }
        );

        // 3b) Dispatch workflow using sql_path (small input)
        const response = await axios.post(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE_NAME}/dispatches`,
            {
                ref: 'main',
                inputs: {
                    sql_path: sqlPath,
                    // queries: "false" // optional, kept for compatibility if your workflow expects it
                }, //Maximum number of properties is 10
            },
            {
                headers: {
                    Authorization: `Bearer ${BOT_TOKEN}`,
                    Accept: 'application/vnd.github+json',
                },
            }
        );

        return res.status(200).json({ message: 'Workflow dispatched', sql_path: sqlPath });
    } catch (err: any) {
        const status = err.response?.status || 500;
        const data = err.response?.data || { message: err.message };
        console.error("Error dispatching:", status, data);
        // Return real status + details to make debugging possible
        return res.status(status).json({ error: "SEND-FORM ERROR", details: data });
    }
}
