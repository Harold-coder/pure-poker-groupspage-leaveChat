const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const groupsTableName = process.env.GROUPS_TABLE;
const connectionsTableName = process.env.CONNECTIONS_TABLE;
const apiGatewayEndpoint = process.env.WEBSOCKET_ENDPOINT;

exports.handler = async (event) => {
    const { groupId, userId } = JSON.parse(event.body);
    const connectionId = event.requestContext.connectionId;

    const apiGateway = new AWS.ApiGatewayManagementApi({
        endpoint: apiGatewayEndpoint
    });

    try {
        // Retrieve the group to ensure it exists and to get current usersConnected
        const groupResponse = await dynamoDb.get({
            TableName: groupsTableName,
            Key: { groupId },
        }).promise();

        const group = groupResponse.Item;

        if (!group) {
            return { statusCode: 404, body: JSON.stringify({ message: "Group not found.", action: 'leaveChat' }) };
        }

        // Proceed only if the user is currently marked as connected
        if (!(group.usersConnected || []).includes(userId)) {
            return { statusCode: 400, body: JSON.stringify({ message: "User not currently connected to the chat.", action: 'leaveChat' }) };
        }

        // Remove the user from the usersConnected list
        const updatedUsersConnected = group.usersConnected.filter(user => user !== userId);

        // Update the group in DynamoDB
        await dynamoDb.update({
            TableName: groupsTableName,
            Key: { groupId },
            UpdateExpression: "SET usersConnected = :usersConnected",
            ExpressionAttributeValues: {
                ':usersConnected': updatedUsersConnected,
            },
        }).promise();

        // Remove the connection from the connections table
        // await dynamoDb.delete({
        //     TableName: connectionsTableName,
        //     Key: { connectionId },
        // }).promise();

        // Broadcast message to all connections that a user has left the chat
        const connections = await dynamoDb.scan({
            TableName: connectionsTableName,
            FilterExpression: 'groupId = :groupId',
            ExpressionAttributeValues: {
                ':groupId': groupId
            }
        }).promise();

        const postCalls = connections.Items.map(async ({ connectionId }) => {
            await apiGateway.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                    action: 'userLeft',
                    userId: userId,
                    groupId: groupId,
                    message: `${userId} has left the chat.`
                })
            }).promise();
        });

        await Promise.all(postCalls);

        return { statusCode: 200, body: JSON.stringify({ message: "User left chat successfully.", action: 'leaveChat' }) };
    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: "Failed to leave chat", action: 'leaveChat' }) };
    }
};
