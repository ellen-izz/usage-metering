
import { useState } from "react";
import "./App.css";

type AccountUsage = {
  accountId: string;
  accountName: string;
  month: string;
  plan: {
    name: string;
    monthlyAllowance: number;
    maxUnitsPerRequest: number;
  };
  usage: {
    usedUnits: number;
    remainingUnits: number;
  };
};

type UsageRecord = {
  id: string;
  userId: string;
  unitsRequested: number;
  status: string;
  decisionReason: string | null;
  createdAt: string;
};

type HistoryResponse = {
  total: number;
  limit: number;
  offset: number;
  requests: UsageRecord[];
};
type AccountUser = {
  id: string;
  name: string;
  userPlanId: string;
};

type UserUsage = {
  userId: string;
  userName: string;
  month: string;
  plan: {
    name: string;
    monthlyAllowance: number;
    maxUnitsPerRequest: number;
  };
  usage: {
    usedUnits: number;
    remainingUnits: number;
  };
};




function App() {
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const [userName, setUserName] = useState("");
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [selectedUserUsage, setSelectedUserUsage] =
    useState<UserUsage | null>(null);
  const [userPlan, setUserPlan] = useState("Basic");
  const [userMessage, setUserMessage] = useState("");
  const [usageUserId, setUsageUserId] = useState("");
  const [units, setUnits] = useState("10");
  const [usageMessage, setUsageMessage] = useState("");
  const [history, setHistory] = useState<UsageRecord[]>([]);
  const [historyMessage, setHistoryMessage] = useState("");

  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const historyPageSize = 10;





  async function connectAccount() {
    setMessage("Connecting...");
    setUsage(null);

    try {
      const response = await fetch("/api/account/usage", {
        headers: {
          Authorization: `ApiKey ${apiKey.trim()}`,
        },
      });

      if (!response.ok) {
        setMessage("Connection failed. Check your API key.");
        return;
      }

      const data: AccountUsage = await response.json();

      console.log("Account usage:", data);

      setUsage(data);
      await loadUsers(apiKey);
      await loadHistory(apiKey);

      setMessage("Account connected successfully!");
    } catch {
      setMessage("Cannot connect to the backend.");
    }
  }

  async function createUser() {
    if (!userName.trim()) {
      setUserMessage("Please enter a user name.");
      return;
    }

    setUserMessage("Creating user...");

    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `ApiKey ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          name: userName.trim(),
          planName: userPlan,
        }),
      });

      if (!response.ok) {
        setUserMessage("Failed to create user.");
        return;
      }

      const data = await response.json();

      setUsageUserId(data.user.id);
      await loadUsers(apiKey);

      setUserMessage(
        `User created successfully! ID: ${data.user.id}`
      );
      setUserName("");
    } catch {
      setUserMessage("Cannot connect to the backend.");
    }
  }

  async function submitUsage() {
    const requestedUnits = Number(units);

    if (
      !usageUserId.trim() ||
      !Number.isSafeInteger(requestedUnits) ||
      requestedUnits <= 0
    ) {
      setUsageMessage("Enter a valid user ID and positive number of units.");
      return;
    }

    setUsageMessage("Submitting usage...");

    try {
      const response = await fetch("/api/usage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `ApiKey ${apiKey.trim()}`,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          userId: usageUserId.trim(),
          units: requestedUnits,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setUsageMessage(data.error || "Request failed.");
        return;
      }

      if (data.allowed) {
        setUsageMessage(
          `Accepted! ${requestedUnits} units consumed.`
        );
      } else {
        setUsageMessage(`Rejected: ${data.reason}`);
      }

      // Fetch updated account quota after processing the request.
      const usageResponse = await fetch("/api/account/usage", {
        headers: {
          Authorization: `ApiKey ${apiKey.trim()}`,
        },
      });

      if (usageResponse.ok) {
        setUsage(await usageResponse.json());
      }
      await loadUserUsage(usageUserId, apiKey);
      await loadHistory(apiKey);



    } catch {
      setUsageMessage("Cannot connect to the backend.");
    }
  }


  async function loadHistory(key: string, page = 1) {
    try {
      const offset = (page - 1) * historyPageSize;

      const response = await fetch(
        `/api/account/history?limit=${historyPageSize}&offset=${offset}`,
        {
          headers: {
            Authorization: `ApiKey ${key.trim()}`,
          },
        }
      );

      if (!response.ok) {
        setHistoryMessage("Failed to load usage history.");
        return;
      }

      const data: HistoryResponse = await response.json();

      setHistory(data.requests);
      setHistoryTotal(data.total);
      setHistoryPage(page);
      setHistoryMessage("");
    } catch (error) {
      console.error("Failed to load history:", error);
      setHistoryMessage("Could not connect to the server.");
    }
  }



  async function loadUsers(key: string) {
    try {
      const response = await fetch("/api/users", {
        headers: {
          Authorization: `ApiKey ${key.trim()}`,
        },
      });

      console.log("Users status:", response.status);

      if (!response.ok) {
        console.error("Failed to load users.");
        return;
      }

      const data: { users: AccountUser[] } =
        await response.json();

      console.log("Users received:", data);

      setUsers(data.users);
    } catch (error) {
      console.error("Cannot load users:", error);
    }
  }

  async function loadUserUsage(userId: string, key: string) {
    if (!userId) {
      setSelectedUserUsage(null);
      return;
    }

    try {
      const response = await fetch(
        `/api/users/${userId}/usage`,
        {
          headers: {
            Authorization: `ApiKey ${key.trim()}`,
          },
        }
      );

      if (!response.ok) {
        setSelectedUserUsage(null);
        return;
      }

      const data: UserUsage = await response.json();

      setSelectedUserUsage(data);
    } catch (error) {
      console.error("Failed to load user usage:", error);
      setSelectedUserUsage(null);
    }
  }








  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <h1>Usage Metering Dashboard</h1>
        <p className="subtitle">
          Monitor account usage, quotas, and limits.
        </p>
      </header>

      <div className="connection">
        <input
          type="password"
          placeholder="Enter your API key"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />

        <button onClick={connectAccount}>
          Connect
        </button>
      </div>

      <p>{message}</p>

      {usage && (
        <>
          {/* Company Information */}
          <section className="account-info">
            <h2>{usage.accountName}</h2>
            <p>
              Plan: {usage.plan.name} | Month: {usage.month}
            </p>
          </section>

          {/* Company Quota */}
          <section className="cards">
            <div className="stat-card">
              <h3>Monthly Limit</h3>
              <p>
                {usage.plan.monthlyAllowance.toLocaleString()}
              </p>
            </div>

            <div className="stat-card">
              <h3>Units Used</h3>
              <p>
                {usage.usage.usedUnits.toLocaleString()}
              </p>
            </div>

            <div className="stat-card">
              <h3>Remaining Units</h3>
              <p>
                {usage.usage.remainingUnits.toLocaleString()}
              </p>
            </div>
          </section>

          {/* Company Quota Progress Bar */}
          <section className="progress-section">
            <h2>Monthly Quota Usage</h2>

            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${usage.plan.monthlyAllowance > 0
                    ? Math.min(
                      100,
                      (usage.usage.usedUnits /
                        usage.plan.monthlyAllowance) * 100
                    )
                    : 0
                    }%`,
                }}
              />
            </div>

            <p className="subtitle">
              {usage.usage.usedUnits.toLocaleString()} of{" "}
              {usage.plan.monthlyAllowance.toLocaleString()} units used
            </p>
          </section>

          {/* Create User */}
          <section className="user-section">
            <h2>Create User</h2>

            <div className="user-form">
              <input
                type="text"
                placeholder="Enter user name"
                value={userName}
                onChange={(event) => setUserName(event.target.value)}
              />

              <select
                value={userPlan}
                onChange={(event) => setUserPlan(event.target.value)}
              >
                <option value="Basic">Basic</option>
                <option value="Premium">Premium</option>
              </select>

              <button onClick={createUser}>
                Create User
              </button>
            </div>

            <p>{userMessage}</p>
          </section>

          {/* Submit Usage */}
          <section className="user-section">
            <h2>Submit Usage</h2>

            <div className="user-form">
              <select
                value={usageUserId}
                onChange={(event) => {
                  const selectedId = event.target.value;

                  setUsageUserId(selectedId);
                  setSelectedUserUsage(null);

                  void loadUserUsage(selectedId, apiKey);
                }}
              >
                <option value="">Select a user</option>

                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>

              <input
                type="number"
                min="1"
                placeholder="Units"
                value={units}
                onChange={(event) => setUnits(event.target.value)}
              />

              <button onClick={submitUsage}>
                Submit Usage
              </button>
            </div>

            <p>{usageMessage}</p>
          </section>

          {/* Individual User Quota - NEW */}
          {selectedUserUsage && (
            <section className="user-section">
              <h2>User Quota: {selectedUserUsage.userName}</h2>

              <p>
                Plan: {selectedUserUsage.plan.name}
                {" | "}
                Month: {selectedUserUsage.month}
              </p>

              <div className="cards">
                <div className="stat-card">
                  <h3>Monthly Limit</h3>
                  <p>
                    {selectedUserUsage.plan.monthlyAllowance.toLocaleString()}
                  </p>
                </div>

                <div className="stat-card">
                  <h3>Units Used</h3>
                  <p>
                    {selectedUserUsage.usage.usedUnits.toLocaleString()}
                  </p>
                </div>

                <div className="stat-card">
                  <h3>Remaining Units</h3>
                  <p>
                    {selectedUserUsage.usage.remainingUnits.toLocaleString()}
                  </p>
                </div>
              </div>

              <p>
                Maximum per request:{" "}
                {selectedUserUsage.plan.maxUnitsPerRequest.toLocaleString()}
              </p>
            </section>
          )}

          {/* Recent Usage History */}
          <section className="user-section">
            <h2>Recent Usage History</h2>

            <button onClick={() => loadHistory(apiKey)}>
              Refresh History
            </button>

            <p>{historyMessage}</p>

            <div className="history-table-wrapper">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>User ID</th>
                    <th>Units</th>
                    <th>Status</th>
                    <th>Reason</th>
                  </tr>
                </thead>

                <tbody>
                  {history.map((record) => (
                    <tr key={record.id}>
                      <td>
                        {new Date(
                          record.createdAt
                        ).toLocaleString()}
                      </td>

                      <td>{record.userId}</td>

                      <td>{record.unitsRequested}</td>

                      <td>{record.status}</td>

                      <td>{record.decisionReason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {history.length === 0 && (
                <p>No usage requests found.</p>
              )}
            </div>

            <div className="pagination">
              <button
                disabled={historyPage === 1}
                onClick={() => void loadHistory(apiKey, historyPage - 1)}
              >
                Previous
              </button>

              <span>
                Page {historyPage} of{" "}
                {Math.max(1, Math.ceil(historyTotal / historyPageSize))}
              </span>

              <button
                disabled={
                  historyPage >= Math.ceil(historyTotal / historyPageSize)
                }
                onClick={() => void loadHistory(apiKey, historyPage + 1)}
              >
                Next
              </button>
            </div>

          </section>
        </>
      )}
    </main>
  );


}

export default App;
